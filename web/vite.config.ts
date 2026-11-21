import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Finishes dist/sw.js after the build: a cache name unique to this build (old files get dropped
 * when the new worker takes over) and the list of built files to store at install, so the app
 * opens offline even right after the first visit.
 */
function serviceWorkerBuild(): Plugin {
  let outDir = 'dist';
  return {
    name: 'budget-me-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const dist = path.resolve(outDir);
      const assets = readdirSync(path.join(dist, 'assets'))
        // Fonts in every script would be a lot; keep the app code, styles and the Latin/Arabic fonts in use.
        .filter((f) => /\.(js|css)$/.test(f) || /(latin|arabic)-(wght|700)-normal-[\w-]+\.woff2$/.test(f))
        .map((f) => `/assets/${f}`)
        .sort();
      const build = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 10);
      const swPath = path.join(dist, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace("'sb-shell-dev'", `'sb-shell-${build}'`)
        .replace('const PRECACHE_ASSETS = [];', `const PRECACHE_ASSETS = ${JSON.stringify(assets)};`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerBuild()],
  server: {
    port: 5173,
    // In development the API runs separately on :3000.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: false },
});
