import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { loginHandler, logoutHandler, requireAuth, signupHandler } from './auth.js';
import type { Db } from './db.js';
import { errorHandler } from './http.js';
import { receiptRoutes } from './receipts.js';
import { apiRoutes } from './routes.js';
import { schemas } from './validation.js';

export interface AppOptions {
  /** Folder with the built React app (index.html). Optional in tests. */
  publicDir?: string;
  /** Express "trust proxy" setting; defaults to private networks (Docker / reverse proxy). */
  trustProxy?: string;
  /** Whether new people may create accounts. Default true. */
  allowSignup?: boolean;
}

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
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
          'upgrade-insecure-requests': null,
        },
      },
      // The app may be served over plain HTTP on a LAN; HSTS belongs on the TLS proxy.
      strictTransportSecurity: false,
    }),
  );
  app.use(cookieParser());
  app.use('/api', express.json({ limit: '5mb' }));

  const api = express.Router();
  api.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });
  const allowSignup = opts.allowSignup ?? true;
  api.get('/auth/config', (_req, res) => {
    res.json({ signupEnabled: allowSignup });
  });
  api.post('/auth/login', loginLimiter, loginHandler(db, (b) => schemas.login.parse(b)));
  const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many new accounts from this network. Try again in an hour.' },
  });
  api.post('/auth/signup', signupLimiter, signupHandler(db, (b) => schemas.signup.parse(b), () => allowSignup));
  api.post('/auth/logout', logoutHandler(db));

  api.use(requireAuth(db));
  api.use(receiptRoutes(db));
  api.use(apiRoutes(db));
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
          } else if (name === 'sw.js' || name.endsWith('.webmanifest')) {
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
