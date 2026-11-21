# MEMORY.md: project decisions and facts

Long-lived facts for Claude sessions. Add an entry whenever a decision is made or a gotcha is found.
Format: `YYYY-MM-DD: decision/fact. Why. (How to apply.)` Newest at the bottom of each section.

## Product
- 2026-11-21: Budget me is a **personal app** for the owner and a few invited people. Not on Google Play, ever (for now). Why: personal use. (No store assets, no Play policies, no public privacy policy needed.)
- 2026-11-21: Languages: English + Egyptian Arabic, RTL supported. Default theme dark ("Emerald night"). Default currency label EGP.
- 2026-11-21: Budget maths mirror the original `Student_Budget.xlsx` workbook (`web/src/domain/calc.ts`). Don't change formulas without the owner.
- 2026-11-21: **No biometric / passkey / fingerprint sign-in or unlock.** The owner tried it and decided against it. (Overrides HANDOFF Phase 5 "Biometric unlock": keep the PIN lock only; don't add `USE_BIOMETRIC`.)
- 2026-11-21: Versions: one patch number per small phase (0.5.2…0.5.6), 0.6.0 = HANDOFF Phase 0+1. Show it as "Version alpha X.Y.Z" under the logo. A short plain summary for the owner after every phase.

## Workflow (owner's rules)
- 2026-11-21: **Never commit or push until the owner says so.** Why: the owner reviews first. (This overrides "one branch + PR per phase" in `CLAUDE.md` until the owner asks for branches/PRs. Commit as `ygyoussefgouda-art@users.noreply.github.com`; never put the owner's private email in commits or requests.)
- 2026-11-21: Standalone project: don't touch anything outside this repo.

## Architecture
- 2026-11-21: Stack: React 18 + Vite 5 + React Query (web), Express 4 + Zod + pg (server), PostgreSQL 16, Docker Compose project `budget-me` on one Linux VPS, app bound to `127.0.0.1:8090` behind nginx/Caddy HTTPS.
- 2026-11-21: Local dev uses **PGlite** (embedded Postgres) via `DB_DRIVER=pglite`; tests run against it too.
- 2026-11-21: Sessions are stored in Postgres, cookie-based, 14 days idle / 30 days max. Passwords: scrypt.
- 2026-11-21: Receipts are stored **in Postgres** (`receipts.data` bytea), quota per account `RECEIPT_QUOTA_MB` (200). So DB backups include receipts.
- 2026-11-21: Deletes go to a `trash` table for Undo; purged every 5 min.
- 2026-11-21: Offline entry: expenses queued in IndexedDB (`budget-me-offline`) with a client-made `clientId`; the server creates at most one expense per `clientId`.
- 2026-11-21 (0.6.0): Server logs = pino JSON lines on stdout (`server/src/log.ts`), one line per /api request (method, path without query, status, ms, userId, reqId). `/api/health` logs at debug only. Silent under vitest. (Log new events with `log.info/warn/error({ ...fields }, 'msg')`, never `console.*`, never bodies.)
- 2026-11-21 (0.6.0): Every /api answer has `X-Request-Id`; unexpected 500s return `{ error, requestId }` and the web appends "(ref. xxxxxxxx)" to the message.
- 2026-11-21 (0.6.0): `APP_VERSION` on the server is read from `server/package.json` (prerelease suffix stripped); the web has its own in `web/src/version.ts`. They must match: `/api/version` `web` differing from the page's version makes the app show "A new version is ready".
- 2026-11-21 (0.6.0): Service worker no longer calls `skipWaiting()` on install. A new worker waits; `UpdateBar` → `applyUpdate()` posts `SKIP_WAITING` and reloads on `controllerchange`. First install still activates at once (no controller).
- 2026-11-21 (0.6.0): Client crashes (ErrorBoundary, window `error`, `unhandledrejection`) go to `POST /api/client-errors` (public, before `requireAuth`, CSRF header needed, rate-limited). API 4xx/offline errors are not reported.

## Android app (decided in hand-off, 2026-11-21)
- **Capacitor, Android only**, in a new `mobile/` folder. No UI rewrite.
- **Remote URL mode**: the APK loads the live VPS site (`server.url`). Why: web deploys update the app instantly; cookies, CSRF Origin check and relative `/api` paths work unchanged. (A new APK is only needed for native changes.)
- **Self-update**: VPS-hosted `latest.json` + signed APK, checked in-app, SHA-256 verified, installed via the system installer. Spec: `docs/ANDROID_SELF_UPDATE.md`.
- **Permissions**: Android can't grant runtime permissions at install time → first-run "Set up permissions" screen with "Allow all". Prefer the Photo Picker (no media permission). No `MANAGE_EXTERNAL_STORAGE`, no battery-optimisation exemption.
- **Notifications**: local notifications only, no Firebase/FCM.
- **APK download**: manifest public, APK behind sign-in, plus optional secret-token link for first install (pending owner confirmation).

## Open questions (move to a section above once answered)
- Production domain: ?
- Android `appId` (proposed `me.budget.app`; can never change after first install): ?
- Offsite backup target + alert channel: ?
- Where the signing keystore is kept: ?
- Signing certificate SHA-256 fingerprint (not secret): ?
- GitHub Actions allowed to SSH-deploy to the VPS: ?

## Gotchas
- 2026-11-21: `legacy-flutter/` exists only on the owner's PC and is git-ignored (`.gitignore`). The README mention was removed in 0.6.0.
- 2026-11-21: `scripts/*.cmd` assume a portable Node at `D:\devtools` on the owner's Windows PC.
- 2026-11-21: Rate limits key by IP with IPv6 grouped by /56 (`ipKey` in `server/src/app.ts`); behind a proxy set `TRUST_PROXY` correctly or every user shares one limit.
- 2026-11-21: Production refuses to start if a password in `.env` still contains `change-me` or `POSTGRES_PASSWORD` < 16 chars.
- 2026-11-21: Service worker cache name is `sb-shell-v4` (0.6.0) in `web/public/sw.js`; bump it when the shell changes. Even without a bump, open apps learn about a new deploy from `/api/version`.
- 2026-11-21: Version bump touches: `web/package.json`, `server/package.json`, `e2e/package.json` **and their `package-lock.json` top-level `version`**, `web/src/version.ts`, README title, E2E/Server tests that assert the version (`e2e/tests/reliability.spec.ts`).
- 2026-11-21: Owner's PC: git/gh/node are portable in `D:\devtools` (`mingit\cmd`, `gh`, `node-v22…`), not on PATH. Only Java 8 is installed (no JDK 21 / Android SDK).
- 2026-11-21: Playwright: `page.route()` still intercepts `/api` calls with our service worker active (it never handles `/api`), so E2E can fake API answers.
- 2026-11-21: Android refuses to install an update with a lower `versionCode` or a different signing key. Losing the keystore = users must uninstall.

## Dependencies added (with reason)
- 2026-11-21: `pino` ^9 (server): structured JSON logging asked for by HANDOFF Phase 1; small, fast, widely used, no transports needed (Docker collects stdout).
