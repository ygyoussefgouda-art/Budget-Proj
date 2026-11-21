import { existsSync } from 'node:fs';
import { isIPv6 } from 'node:net';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Request } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import {
  changePasswordHandler,
  deleteAccountHandler,
  loginHandler,
  logoutAllHandler,
  logoutHandler,
  requireAuth,
  setAdminUsernames,
  signupHandler,
} from './auth.js';
import type { Db } from './db.js';
import { ah, errorHandler, HttpError } from './http.js';
import { receiptRoutes } from './receipts.js';
import { recurringRoutes } from './recurring.js';
import { exportRoutes } from './export.js';
import { adminRoutes, resetPasswordHandler, signupConfig } from './admin.js';
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
  /** If set, sign-up needs this invite code. */
  inviteCode?: string;
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
}

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'budget-me';

/** Rate-limit key: the client IP, with IPv6 grouped by /56 (one home/VPS gets a whole /56 or /64). */
export function ipKey(req: Request) {
  const ip = req.ip ?? 'unknown';
  if (!isIPv6(ip) || ip.startsWith('::ffff:')) return ip;
  const full = ip.split('::');
  const head = full[0] ? full[0].split(':') : [];
  const tail = full.length > 1 && full[1] ? full[1].split(':') : [];
  const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  // first 56 bits = 3.5 groups
  return `${groups.slice(0, 3).join(':')}:${(groups[3] ?? '0').padStart(4, '0').slice(0, 2)}::/56`;
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

  // ---------- /api ----------
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

  // .env defaults; an admin can change them in the app (stored in app_settings).
  const signupDefaults = { allowSignup: opts.allowSignup ?? true, inviteCode: opts.inviteCode ?? '' };
  setAdminUsernames(opts.adminUsernames ?? []);
  api.get(
    '/auth/config',
    ah(async (_req, res) => {
      const c = await signupConfig(db, signupDefaults);
      res.json({ signupEnabled: c.allowed, inviteRequired: c.allowed && !!c.inviteCode });
    }),
  );

  const loginIpLimiter = limiter(15, opts.loginLimit ?? 20, 'Too many sign-in attempts. Try again in 15 minutes.');
  // Per-account limit on *failed* sign-ins: stops password guessing spread over many IPs.
  const loginAccountLimiter = limiter(15, 10, 'Too many sign-in attempts. Try again in 15 minutes.', {
    skipSuccessfulRequests: true,
    keyGenerator: (req: Request) => `u:${String((req.body as { username?: unknown })?.username ?? 'owner').trim().toLowerCase().slice(0, 60)}`,
  });
  api.post('/auth/login', loginIpLimiter, loginAccountLimiter, loginHandler(db, (b) => schemas.login.parse(b)));
  const signupLimiter = limiter(60, opts.signupLimit ?? 10, 'Too many new accounts from this network. Try again in an hour.');
  api.post(
    '/auth/signup',
    signupLimiter,
    signupHandler(db, (b) => schemas.signup.parse(b), () => signupConfig(db, signupDefaults)),
  );
  // "Forgot password?": a one-time code from an admin. Same limits as sign-in (per network + failures per account).
  api.post('/auth/reset', loginIpLimiter, loginAccountLimiter, resetPasswordHandler(db));
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
  api.post('/auth/delete-account', passwordLimiter, deleteAccountHandler(db, (b) => schemas.deleteAccount.parse(b)));

  api.use(receiptRoutes(db));
  api.use(apiRoutes(db));
  api.use(recurringRoutes(db));
  api.use(exportRoutes(db));
  api.use(undoRoutes(db));
  api.use(adminRoutes(db, signupDefaults));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use('/api', api);
  app.use('/api', errorHandler);

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
    // Single-page app: every other GET returns index.html.
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(pub, 'index.html'));
    });
  }

  return app;
}
