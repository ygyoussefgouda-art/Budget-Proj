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
const mkApp = () => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, publicDir: pub });

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  pub = mkdtempSync(path.join(tmpdir(), 'bm-public-'));
  mkdirSync(path.join(pub, 'assets'));
  writeFileSync(path.join(pub, 'index.html'), INDEX);
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
