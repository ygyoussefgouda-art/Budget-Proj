import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import {
  changePasswordHandler,
  deleteAccountHandler,
  loginHandler,
  logoutAllHandler,
  logoutHandler,
  requireAuth,
  setAdminUsernames,
  setEmailHandler,
  setSignupPolicy,
  signupHandler,
  signupPolicy,
} from './auth.js';
import { noMailer, type Mailer } from './mail.js';
import { loginSecondStepHandler, twoFactorRoutes } from './twoFactor.js';
import type { Db } from './db.js';
import { ah, errorHandler, HttpError } from './http.js';
import { APP_VERSION, log, requestId, requestLogger } from './log.js';
import { appReleaseRoutes, readAndroidManifest } from './appRelease.js';
import { receiptRoutes } from './receipts.js';
import { recurringRoutes } from './recurring.js';
import { exportRoutes } from './export.js';
import { adminRoutes, forgotPasswordHandler, resetPasswordHandler, signupConfig } from './admin.js';
import { undoRoutes } from './undo.js';
import { apiRoutes } from './routes.js';
import { schemas } from './validation.js';

export interface AppOptions {
  /** Folder with the built React app (index.html). Optional in tests. */
  publicDir?: string;
  /** Express "trust proxy" setting; defaults to private networks (Docker / reverse proxy). */
  trustProxy?: string | number | boolean;
  /** Whether new people may create accounts. Default true. */
  allowSignup?: boolean;
  /** Sign-in attempts per IP per 15 minutes (default 20). */
  loginLimit?: number;
  /** New accounts per IP per hour (default 10). */
  signupLimit?: number;
  /** Send HSTS from the app (only when served over HTTPS and the proxy doesn't). */
  hsts?: boolean;
  /** Require the X-Requested-With header on writes (CSRF defence). Default true. */
  csrfHeader?: boolean;
  /** Usernames that may open the admin page (the built-in "owner" always can). From ADMIN_USERNAMES. */
  adminUsernames?: string[];
  /** Installed Android apps below this versionCode must update first (GET /api/version). Default 0. */
  minNativeVersionCode?: number;
  /** Sign-up needs an email (default true). Older tests switch it off. */
  requireEmail?: boolean;
  /** New passwords need 8+ characters with lower, upper, number and special (default true). */
  strongPasswords?: boolean;
  /** Sends "Forgot password?" codes. Without it, only admins can make reset codes. */
  mailer?: Mailer;
  /** Shown in Settings → Contact us (CONTACT_EMAIL). */
  contactEmail?: string;
  /** Folder with android/latest.json and the APKs (DOWNLOADS_DIR). */
  downloadsDir?: string;
  /** "Forgot password?" emails per network per 15 minutes (default 5). */
  forgotLimit?: number;
  /** Failed sign-ins per account from all networks together per 15 minutes (default 200). */
  accountFailLimit?: number;
  /** Crash reports per IP per 15 minutes (default 30). */
  clientErrorLimit?: number;
  /** APP_ONLY: only the Android app may use the site; browsers get the "Get the app" page. Default false. */
  appOnly?: boolean;
}

/** The Android app adds this to its user agent (mobile/capacitor.config.ts → android.appendUserAgent). */
export const APP_USER_AGENT = 'BudgetMeApp';
export const isAppRequest = (req: Request) => new RegExp(`\\b${APP_USER_AGENT}\\b`).test(req.get('user-agent') ?? '');

/**
 * Open to everyone even with APP_ONLY: health and version checks (Docker, the app's update check),
 * the APK download, and the files of the "Get the app" page itself.
 */
const APP_ONLY_OPEN = /^\/(?:api\/(?:health|version|app\/android\/.*)|download\/android|get-app\.(?:html|css)|icon(?:-[\w-]+)?\.(?:svg|png)|manifest\.webmanifest)$/;

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'budget-me';

/**
 * Rate-limit key: the client IP, with IPv6 grouped by /56 (one home/VPS gets a whole /56 or /64).
 * Uses express-rate-limit's own helper, which also turns IPv4-in-IPv6 (::ffff:1.2.3.4) back into IPv4.
 */
export function ipKey(req: Request) {
  return ipKeyGenerator(req.ip ?? 'unknown', 56);
}

const limiter = (windowMin: number, limit: number, error: string, extra: Partial<Parameters<typeof rateLimit>[0]> = {}) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: ipKey,
    validate: { trustProxy: false, xForwardedForHeader: false },
    message: { error },
    ...extra,
  });

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Only trust X-Forwarded-* from private addresses (the reverse proxy / Docker network).
  // Behind a single known proxy, set TRUST_PROXY to its address or to 1.
  app.set('trust proxy', opts.trustProxy ?? 'loopback, linklocal, uniquelocal');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'], // blob: = receipt preview before upload
          'style-src': ["'self'", "'unsafe-inline'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'manifest-src': ["'self'"],
          'worker-src': ["'self'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
      // Usually the HTTPS reverse proxy sends HSTS; HSTS=true makes the app send it too.
      strictTransportSecurity: opts.hsts ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );
  app.use(cookieParser());

  // ---------- APP_ONLY: the Android app only (owner's choice) ----------
  // Browsers get the "Get the Masrofy app" page and the API answers them 403. This keeps people on the
  // app; it is not a security boundary (anyone can fake a user agent): accounts are still protected by
  // their passwords, sessions, CSRF checks and rate limits as before.
  if (opts.appOnly) {
    app.use((req, res, next) => {
      res.vary('User-Agent'); // a cache must never hand the app's answer to a browser or the other way round
      if (isAppRequest(req) || APP_ONLY_OPEN.test(req.path)) return next();
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        return void res.status(403).json({ error: 'Masrofy is only available in the app.', code: 'app_only' });
      }
      const page = opts.publicDir ? path.join(opts.publicDir, 'get-app.html') : '';
      res.setHeader('Cache-Control', 'no-cache');
      if (page && existsSync(page)) return void res.status(200).sendFile(page);
      res.status(403).type('text/plain').send('Masrofy is only available in the Android app.');
    });
  }

  // ---------- /api ----------
  app.use('/api', requestLogger); // request id + one log line per request
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // never keep personal data in browser/proxy caches
    next();
  });
  // Coarse per-network limit for everything (protects against floods).
  app.use('/api', limiter(5, 1500, 'Too many requests. Slow down and try again in a few minutes.'));

  // CSRF: writes must come from our own pages. Forms and cross-site pages cannot set this header,
  // and a cross-origin fetch with it needs a CORS preflight, which this app never allows.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let ok = false;
      try {
        const host = req.get('x-forwarded-host') ?? req.get('host');
        ok = new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) return next(new HttpError(403, 'Request blocked: it did not come from this app.', 'bad_origin'));
    }
    if ((opts.csrfHeader ?? true) && req.get(CSRF_HEADER) !== CSRF_VALUE) {
      return next(new HttpError(403, 'Request blocked: it did not come from this app.', 'csrf'));
    }
    next();
  });

  // Small JSON bodies everywhere; the backup restore route has its own larger parser (after sign-in).
  const smallJson = express.json({ limit: '100kb' });
  app.use('/api', (req, res, next) => (req.path === '/backup/restore' ? next() : smallJson(req, res, next)));

  const api = express.Router();
  api.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Which version is running. The web app and (later) the Android app compare against it.
  api.get('/version', (_req, res) => {
    res.json({ web: APP_VERSION, api: APP_VERSION, minNativeVersionCode: opts.minNativeVersionCode ?? 0 });
  });

  // Android app: newest version + APK download (open link, owner's choice).
  api.use(appReleaseRoutes(opts.downloadsDir));

  // Crash reports from the web app (also before sign-in, e.g. a crash on the login screen).
  // Small, rate-limited, and only the listed text fields are written to the log.
  api.post(
    '/client-errors',
    limiter(15, opts.clientErrorLimit ?? 30, 'Too many reports. Try again later.'),
    (req, res) => {
      const r = schemas.clientError.parse(req.body);
      log.warn({ reqId: requestId(res), client: r }, 'client error');
      res.status(204).end();
    },
  );

  // .env defaults; an admin can change them in the app (stored in app_settings).
  const signupDefaults = { allowSignup: opts.allowSignup ?? true };
  setAdminUsernames(opts.adminUsernames ?? []);
  setSignupPolicy({ requireEmail: opts.requireEmail, strongPasswords: opts.strongPasswords });
  const mailer = opts.mailer ?? noMailer;
  api.get(
    '/auth/config',
    ah(async (_req, res) => {
      const c = await signupConfig(db, signupDefaults);
      res.json({
        signupEnabled: c.allowed,
        emailRequired: signupPolicy().requireEmail,
        strongPasswords: signupPolicy().strongPasswords,
        // "Forgot password?" can email a code (otherwise: ask an admin).
        emailReset: mailer.enabled,
        contactEmail: opts.contactEmail || null,
      });
    }),
  );

  const loginIpLimiter = limiter(15, opts.loginLimit ?? 20, 'Too many sign-in attempts. Try again in 15 minutes.');
  // Failed sign-ins per account. Two layers so a stranger can't lock someone out:
  // - 10 failures per account *from one network* (stops guessing from one place, only blocks that network);
  // - 200 failures per account from everywhere together (stops guessing spread over many networks).
  const accountName = (req: Request) => String((req.body as { username?: unknown })?.username ?? 'owner').trim().toLowerCase().slice(0, 60);
  const loginAccountNetLimiter = limiter(15, 10, 'Too many sign-in attempts. Try again in 15 minutes.', {
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => `u:${accountName(req)}|${ipKey(req)}`,
  });
  const loginAccountAllLimiter = limiter(15, opts.accountFailLimit ?? 200, 'Too many sign-in attempts. Try again in 15 minutes.', {
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => `ua:${accountName(req)}`,
  });
  const loginAccountLimiter = [loginAccountNetLimiter, loginAccountAllLimiter];
  api.post('/auth/login', loginIpLimiter, loginAccountLimiter, loginHandler(db, (b) => schemas.login.parse(b)));
  const signupLimiter = limiter(60, opts.signupLimit ?? 10, 'Too many new accounts from this network. Try again in an hour.');
  api.post(
    '/auth/signup',
    signupLimiter,
    signupHandler(db, (b) => schemas.signup.parse(b), () => signupConfig(db, signupDefaults)),
  );
  // "Forgot password?": a one-time code from an admin. Same limits as sign-in (per network + failures per account).
  api.post('/auth/reset', loginIpLimiter, loginAccountLimiter, resetPasswordHandler(db));
  // "Forgot password?" by email: a few per network, and a few per address (stops mail bombing someone).
  api.post(
    '/auth/forgot',
    limiter(15, opts.forgotLimit ?? 5, 'Too many requests. Try again in 15 minutes.'),
    limiter(60, 3, 'A code was sent recently. Check your inbox (and spam), or try again in an hour.', {
      keyGenerator: (req: Request) => {
        const b = req.body as { login?: unknown; email?: unknown } | undefined;
        return `f:${String(b?.login ?? b?.email ?? '').trim().toLowerCase().slice(0, 254)}`;
      },
    }),
    forgotPasswordHandler(db, mailer),
  );
  // Two-step sign-in, second step (same limits as signing in).
  api.post('/auth/login/2fa', loginIpLimiter, loginSecondStepHandler(db));
  api.post('/auth/logout', logoutHandler(db));

  api.use(requireAuth(db));

  // Per-account limit on changes (uploads, restores, edits): stops one account from flooding the server.
  api.use(
    limiter(15, 600, 'You are making changes too quickly. Wait a few minutes and try again.', {
      keyGenerator: (req: Request) => `w:${req.user!.id}`,
      skip: (req: Request) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    }),
  );
  const passwordLimiter = limiter(15, 10, 'Too many attempts. Try again in 15 minutes.', {
    keyGenerator: (req: Request) => `p:${req.user!.id}`,
  });
  api.post('/auth/password', passwordLimiter, changePasswordHandler(db, (b) => schemas.changePassword.parse(b)));
  api.post('/auth/logout-all', logoutAllHandler(db));
  api.put('/auth/email', passwordLimiter, setEmailHandler(db, (b) => schemas.setEmail.parse(b)));
  api.use('/auth/2fa', passwordLimiter);
  api.use(twoFactorRoutes(db));
  api.post('/auth/delete-account', passwordLimiter, deleteAccountHandler(db, (b) => schemas.deleteAccount.parse(b)));

  api.use(receiptRoutes(db));
  api.use(apiRoutes(db));
  api.use(recurringRoutes(db));
  api.use(exportRoutes(db));
  api.use(undoRoutes(db));
  // Admin actions that check the admin's password get the same guessing limit as other password checks.
  api.post(['/admin/users/:id/reset-code', '/admin/users/:id/delete'], passwordLimiter);
  api.use(adminRoutes(db, signupDefaults));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use('/api', api);
  app.use('/api', errorHandler);

  // Short link for the newest Android app, e.g. to type on a new phone: https://<site>/download/android
  app.get('/download/android', (_req, res) => {
    const m = opts.downloadsDir ? readAndroidManifest(opts.downloadsDir) : null;
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, m ? `/api/app/android/apk/${m.apk}` : '/');
  });

  const pub = opts.publicDir;
  if (pub && existsSync(path.join(pub, 'index.html'))) {
    app.use(
      express.static(pub, {
        index: false,
        setHeaders(res, file) {
          const name = path.basename(file);
          if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (name === 'sw.js' || name.endsWith('.webmanifest') || name === 'theme-init.js') {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    // Single-page app: every other GET returns index.html. ('/{*rest}' is Express 5's catch-all; it also matches '/'.)
    app.get('/{*rest}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(pub, 'index.html'));
    });
  }

  return app;
}
