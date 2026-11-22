# CLAUDE.md: Budget me

Personal budget app: **React (Vite, TS) PWA + Node/Express API (TS) + PostgreSQL**, deployed with Docker
Compose on the owner's Linux VPS. Being turned into a **sideloaded Android app (Capacitor)** with self-update.
Not published on Google Play.

## Read first, every session
1. `PROGRESS.md`: what is done, what is next. Continue from the first unchecked item.
2. `MEMORY.md`: decisions and gotchas. Don't re-decide what is recorded there.
3. `CODEMAP.md`: where things live. Update it when you add/move files.
4. `HANDOFF.md` (phase plan) and `docs/ANDROID_SELF_UPDATE.md` (update/download spec) when working on those phases.

## Commands
```bash
# API (embedded Postgres, no Docker)
cd server && npm ci
DB_DRIVER=pglite PGLITE_DIR=.pglite npm run dev     # http://localhost:3000
npm run typecheck && npm test                       # vitest against real embedded Postgres

# Web
cd web && npm ci
npm run dev        # http://localhost:5173, proxies /api to :3000
npm test           # vitest (domain maths)
npm run build      # tsc --noEmit + vite build -> web/dist

# E2E (phone-sized Chromium against the real app; build web first)
cd e2e && npm ci && npx playwright install chromium && npx playwright test

# Production (on the VPS)
docker compose up -d --build        # see DEPLOY.md
sh deploy/update.sh

# Android (once mobile/ exists)
cd mobile && npm ci && npx cap sync android
cd android && ./gradlew assembleRelease
```
Windows PowerShell: set env vars first (`$env:DB_DRIVER='pglite'; $env:PGLITE_DIR='.pglite'; npm run dev`).
On the owner's PC the `scripts\*.cmd` helpers use a portable Node in `D:\devtools`; use `scripts\n.cmd npm ...` there.

## Conventions (must follow)
- **Money = integer minor units** (BIGINT in SQL, integer `number` in TS). Never floats. Parse with `web/src/domain/money.ts`.
- **Every data row is scoped by `user_id`.** Every query on user data filters by `req.user!.id`. New tables get `user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE`.
- **Migrations** are append-only: new file `server/migrations/NNN_name.sql`, next number. Never edit an applied migration.
- **Validation** with Zod schemas in `server/src/validation.ts`; throw `HttpError` (`server/src/http.ts`) for user-facing errors.
- **Writes need the CSRF header** `X-Requested-With: budget-me` (the web `api.ts` adds it). Don't weaken the Origin/CSRF check in `server/src/app.ts`.
- **Dates** are plain `YYYY-MM-DD` strings computed in UTC (`server/src/dates.ts`); the client sends `X-Local-Date`.
- **i18n**: English text is the key: `t('Some text')`. Every new string needs an Egyptian-Arabic entry in `web/src/i18n-ar.ts`. Check RTL layout.
- **Per-account limits** live in `server/src/limits.ts`; add a cap for any new user-generated collection.
- **Native code paths** go through `web/src/native.ts` (`isNative()`), so the same web build works in a browser and in the APK.
- Keep the browser PWA working. The APK is an addition.
- Fingerprint/face only as **app-lock unlock inside the Android app** (native BiometricPrompt, PIN fallback, HANDOFF Phase 5). No browser WebAuthn/passkeys, and never for signing in (owner's decision).
- Small, focused components; follow the existing style (function components, React Query, no new state library).
- No new dependency without a reason written in `MEMORY.md`. Prefer small, well-known packages.

## Security rules
- Never commit secrets: `.env`, `*.jks`, `*.keystore`, `keystore.properties`, deploy keys, backup encryption keys.
- Never log request bodies, passwords, cookies, reset codes or tokens. Use `log` from `server/src/log.ts` (pino), not `console.*`.
- Keep `Cache-Control: no-store` on `/api`. Keep the Helmet CSP strict; document any change in `MEMORY.md`.
- Public endpoints go **before** `requireAuth` in `server/src/app.ts`. Anything that writes, checks a password or is costly needs its own rate limit; cheap reads (`/health`, `/version`, `/auth/config`) rely on the global per-network limit.

## Workflow
- **Don't commit or push until the owner says so** (owner's rule, see `MEMORY.md`). When asked: one branch + PR per phase (`phase-N-short-name`), small commits with clear messages.
- Before each PR: server typecheck + tests, web tests + build, E2E. Add tests for new endpoints/screens.
- At the end of every work session/phase: tick items in `PROGRESS.md`, add decisions to `MEMORY.md`, update `CODEMAP.md`.
- Bump versions together: `web/package.json`, `server/package.json`, `e2e/package.json` (+ the three `package-lock.json` top-level versions), `web/src/version.ts` (`APP_VERSION`; the mark `MARK` = MK1 only changes when the owner says), README title, version asserts in `e2e/tests/reliability.spec.ts`; Android `versionCode`/`versionName` in `mobile/` for native releases.
- Ask the owner before: changing the Android `appId`, rotating the signing key, changing backup targets, deleting data, or anything on the VPS that isn't in `DEPLOY.md`.
