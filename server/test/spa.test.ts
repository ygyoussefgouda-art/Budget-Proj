/** Serving the web app: static files + single-page fallback (Express 5 catch-all route). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Db;
let pub: string;
const INDEX = '<!doctype html><title>Budget me test page</title>';
const GET_APP = '<!doctype html><title>Get the Budget me app</title>';
const mkApp = (appOnly = false) => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, publicDir: pub, appOnly });
const APP_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 BudgetMeApp';
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  pub = mkdtempSync(path.join(tmpdir(), 'bm-public-'));
  mkdirSync(path.join(pub, 'assets'));
  writeFileSync(path.join(pub, 'index.html'), INDEX);
  writeFileSync(path.join(pub, 'get-app.html'), GET_APP);
  writeFileSync(path.join(pub, 'get-app.css'), 'body{}');
  writeFileSync(path.join(pub, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(path.join(pub, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(path.join(pub, 'sw.js'), '// sw');
  writeFileSync(path.join(pub, '.env'), 'SECRET=1');
}, 60_000);
afterAll(async () => {
  await db?.close();
  rmSync(pub, { recursive: true, force: true });
});

describe('web app serving', () => {
  it('the root and any app page return index.html, not cached', async () => {
    const app = mkApp();
    for (const p of ['/', '/budget', '/expenses/12', '/settings/deep/link']) {
      const r = await request(app).get(p).expect(200);
      expect(r.text, p).toBe(INDEX);
      expect(r.headers['cache-control'], p).toBe('no-cache');
    }
  });

  it('built assets are long-cached; the service worker is not', async () => {
    const app = mkApp();
    const a = await request(app).get('/assets/app-123.js').expect(200);
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const sw = await request(app).get('/sw.js').expect(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
  });

  it('unknown /api paths stay JSON errors and never fall through to the page', async () => {
    const r = await request(mkApp()).get('/api/no-such-thing');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.text).not.toContain('Budget me test page');
  });

  it('hidden files and path tricks never leak files', async () => {
    const app = mkApp();
    for (const p of ['/.env', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2F.env', '/..%5C.env']) {
      const r = await request(app).get(p);
      expect(r.text, p).not.toContain('SECRET');
    }
  });

  it('odd query strings do not crash the server', async () => {
    const r = await request(mkApp()).get('/budget?a[b][c]=1&a=2&__proto__[x]=1');
    expect(r.status).toBe(200);
  });
});

describe("APP_ONLY: only the Android app (owner's choice)", () => {
  it('off by default: a browser gets the app as before', async () => {
    const r = await request(mkApp()).get('/budget').set('User-Agent', BROWSER_UA).expect(200);
    expect(r.text).toBe(INDEX);
  });

  it('a browser gets the "Get the app" page on every page, and the API refuses it', async () => {
    const app = mkApp(true);
    for (const p of ['/', '/budget', '/settings', '/assets/app-123.js', '/sw.js']) {
      const r = await request(app).get(p).set('User-Agent', BROWSER_UA);
      expect(r.text, p).toBe(GET_APP);
      expect(r.headers.vary, p).toMatch(/User-Agent/i);
    }
    for (const [method, p] of [['get', '/api/auth/me'], ['get', '/api/auth/config'], ['post', '/api/auth/login'], ['post', '/api/auth/signup']] as const) {
      const r = await request(app)[method](p).set('User-Agent', BROWSER_UA).send({ username: 'someone', password: 'whatever-123' });
      expect(r.status, p).toBe(403);
      expect(r.body.code, p).toBe('app_only');
      expect(r.headers['cache-control'], p).toBe('no-store');
    }
  });

  it('the app gets everything as usual', async () => {
    const app = mkApp(true);
    expect((await request(app).get('/budget').set('User-Agent', APP_UA).expect(200)).text).toBe(INDEX);
    const cfg = await request(app).get('/api/auth/config').set('User-Agent', APP_UA).expect(200);
    expect(cfg.body).toHaveProperty('signupEnabled');
    expect((await request(app).get('/api/auth/me').set('User-Agent', APP_UA)).status).toBe(401); // normal: not signed in
  });

  it("health, version, the APK download and the page's own files stay open to everyone", async () => {
    const app = mkApp(true);
    await request(app).get('/api/health').set('User-Agent', BROWSER_UA).expect(200);
    await request(app).get('/api/version').set('User-Agent', BROWSER_UA).expect(200);
    expect((await request(app).get('/api/app/android/latest').set('User-Agent', BROWSER_UA)).status).not.toBe(403); // 404: no release in tests
    expect((await request(app).get('/download/android').set('User-Agent', BROWSER_UA)).status).toBe(302);
    expect((await request(app).get('/get-app.css').set('User-Agent', BROWSER_UA).expect(200)).text).toBe('body{}');
    await request(app).get('/icon.svg').set('User-Agent', BROWSER_UA).expect(200);
    // a look-alike name is not the app
    expect((await request(app).get('/api/auth/config').set('User-Agent', `${BROWSER_UA} NotBudgetMeAppX`)).status).toBe(403);
  });
});