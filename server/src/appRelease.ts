import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError } from './http.js';

/**
 * Android app downloads (docs/ANDROID_SELF_UPDATE.md). The owner chose an open download link, so
 * these routes are public; the phone checks the SHA-256 and Android checks the signature, so a
 * tampered file can't replace the real app. Files live in DOWNLOADS_DIR/android:
 *   latest.json + masrofy-<versionName>.apk (the last few kept). Releases before 2.0.0 were named budget-me-<versionName>.apk; both are served.
 */
const APK_NAME = /^(masrofy|budget-me)-\d+\.\d+\.\d+\.apk$/;

const manifestSchema = z.object({
  appId: z.string(),
  versionCode: z.number().int().positive(),
  versionName: z.string().regex(/^\d+\.\d+\.\d+$/),
  minVersionCode: z.number().int().min(0).default(0),
  mandatory: z.boolean().default(false),
  apk: z.string().regex(APK_NAME),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  releasedAt: z.string().optional(),
  notes: z.object({ en: z.array(z.string()).default([]), ar: z.array(z.string()).default([]) }).default({ en: [], ar: [] }),
});
export type AndroidManifest = z.infer<typeof manifestSchema>;

/** Reads latest.json; null when there is no Android release yet (or the file is broken). */
export function readAndroidManifest(dir: string): AndroidManifest | null {
  const file = path.join(dir, 'android', 'latest.json');
  if (!existsSync(file)) return null;
  try {
    return manifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

export function appReleaseRoutes(downloadsDir: string | undefined): Router {
  const r = Router();
  const dir = downloadsDir ? path.resolve(downloadsDir) : undefined;

  // What the newest Android app is (the app compares versionCode with its own).
  r.get('/app/android/latest', (_req, res) => {
    const m = dir ? readAndroidManifest(dir) : null;
    if (!m) throw new HttpError(404, 'There is no Android app to download yet.', 'no_release');
    res.json({ ...m, downloadUrl: `/api/app/android/apk/${m.apk}` });
  });

  // The APK file itself. Only names like masrofy-1.2.3.apk (or the older budget-me-1.2.3.apk), only from the android folder.
  r.get(
    '/app/android/apk/:file',
    ah(async (req, res) => {
      const name = String(req.params.file);
      if (!dir || !APK_NAME.test(name)) throw new HttpError(404, 'Not found.');
      const file = path.join(dir, 'android', name);
      if (!existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'Not found.');
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', String(statSync(file).size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await new Promise<void>((resolve, reject) => {
        const s = createReadStream(file);
        s.on('error', reject);
        s.on('end', () => resolve());
        s.pipe(res);
      });
    }),
  );

  return r;
}
