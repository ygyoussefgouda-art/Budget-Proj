/** Phase 3: Android app manifest + APK download (open link). */
import { createHash } from 'node:crypto';
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
let downloads: string;
const apk = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(5000, 7)]);
const sha = createHash('sha256').update(apk).digest('hex');
const manifest = {
  appId: 'com.budgetme.app',
  versionCode: 3,
  versionName: '0.6.5',
  minVersionCode: 1,
  mandatory: false,
  apk: 'budget-me-0.6.5.apk',
  size: apk.length,
  sha256: sha,
  releasedAt: '2026-11-22T10:00:00Z',
  notes: { en: ['Camera receipts'], ar: ['صور الإيصالات بالكاميرا'] },
};
const mkApp = (dir?: string) => createApp(db, { requireEmail: false, strongPasswords: false, csrfHeader: false, downloadsDir: dir });

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, path.join(here, '..', 'migrations'));
  downloads = mkdtempSync(path.join(tmpdir(), 'bm-downloads-'));
  mkdirSync(path.join(downloads, 'android'));
  writeFileSync(path.join(downloads, 'android', 'latest.json'), JSON.stringify(manifest));
  writeFileSync(path.join(downloads, 'android', 'budget-me-0.6.5.apk'), apk);
  writeFileSync(path.join(downloads, 'secret.txt'), 'not for download');
}, 60_000);
afterAll(async () => {
  await db?.close();
  rmSync(downloads, { recursive: true, force: true });
});

describe('Android app downloads', () => {
  it('the manifest is public and points at the APK', async () => {
    const r = await request(mkApp(downloads)).get('/api/app/android/latest').expect(200);
    expect(r.body).toMatchObject({ versionCode: 3, versionName: '0.6.5', sha256: sha, size: apk.length, downloadUrl: '/api/app/android/apk/budget-me-0.6.5.apk' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('the APK downloads without sign-in, as an attachment, byte for byte', async () => {
    const r = await request(mkApp(downloads)).get('/api/app/android/apk/budget-me-0.6.5.apk').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(r.headers['content-disposition']).toBe('attachment; filename="budget-me-0.6.5.apk"');
    expect(createHash('sha256').update(r.body as Buffer).digest('hex')).toBe(sha);
  });

  it('only real APK names from the android folder: no path tricks', async () => {
    const app = mkApp(downloads);
    for (const bad of ['..%2Fsecret.txt', '%2E%2E%2Fsecret.txt', 'secret.txt', 'budget-me-0.6.5.apk.json', 'budget-me-9.9.9.apk']) {
      expect((await request(app).get(`/api/app/android/apk/${bad}`)).status, bad).toBe(404);
    }
  });

  it('the short link goes to the newest APK', async () => {
    const r = await request(mkApp(downloads)).get('/download/android').expect(302);
    expect(r.headers.location).toBe('/api/app/android/apk/budget-me-0.6.5.apk');
  });

  it('no release yet (or a broken manifest): a clear 404', async () => {
    expect((await request(mkApp(undefined)).get('/api/app/android/latest')).status).toBe(404);
    const broken = mkdtempSync(path.join(tmpdir(), 'bm-broken-'));
    mkdirSync(path.join(broken, 'android'));
    writeFileSync(path.join(broken, 'android', 'latest.json'), '{"apk":"../../etc/passwd"}');
    const r = await request(mkApp(broken)).get('/api/app/android/latest');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('no_release');
    rmSync(broken, { recursive: true, force: true });
  });
});
