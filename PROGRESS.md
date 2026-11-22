# PROGRESS.md

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why).
Update at the end of every session. Phases come from `HANDOFF.md` §4.

**Current version:** MK1 (1.2.1) · **Current phase:** all HANDOFF phases built; left: things only the owner can do (phone test, signing key, VPS setup, LICENSE) · **Last updated:** 2026-11-22

## Phase 0: Hand-off setup
- [-] Clone repo, branch `phase-0-handoff`: worked on `main` in the existing checkout; the owner commits/pushes only when they say so (see `MEMORY.md`)
- [x] Copy `CLAUDE.md`, `MEMORY.md`, `PROGRESS.md`, `CODEMAP.md`, `HANDOFF.md`, `docs/ANDROID_SELF_UPDATE.md` into the repo
- [x] Run baseline tests and record results below
- [ ] Get answers to the open questions in `MEMORY.md` (needed before Phase 2)
- [ ] Committed / PR merged (waiting for the owner's go-ahead)

Baseline test results (alpha 0.5.6, commit `66a3169`, GitHub CI run 44931074592): server ✅ 91 · web ✅ 23 · build ✅ · e2e ✅ 42

## Phase 1: Reliability basics (alpha 0.6.0)
- [x] React `ErrorBoundary` with reload + version (`web/src/components/ErrorBoundary.tsx`, wraps everything in `main.tsx`)
- [x] Structured server logging (pino) + request id (`X-Request-Id`); errors logged in `errorHandler`, 500s return `requestId` (the web shows "ref. xxxxxxxx")
- [x] `GET /api/version` (`web`, `api`, `minNativeVersionCode` from `MIN_NATIVE_VERSION_CODE`)
- [x] Service worker "New version, Reload" prompt (no silent `skipWaiting`; `SKIP_WAITING` message; also shown when `/api/version` reports a different web version). Cache `sb-shell-v4`
- [x] Client crash reporting: `POST /api/client-errors` (public, CSRF header, 30/15 min per IP, size-limited, max 5 per page load) → server log
- [x] Tests added: `server/test/reliability.test.ts` (6), `e2e/tests/reliability.spec.ts` (3)
- [ ] Committed / PR merged (waiting for the owner's go-ahead)

Phase 1 test results: see the Log below.

## Review fixes (alpha 0.6.1), from `docs/REVIEW-2026-11-21.md` section A
- [x] Backups refuse incomplete dumps (`backup-now.sh`, daily backup service); `update.sh` stops if the backup fails; `restore.sh` refuses an incomplete file
- [x] Reset codes need the admin's password; listed admins can't reset or remove other admins (only `owner`); no codes for `owner`; admin password checks rate-limited
- [x] Sign-in failures limited per account **and network** (10) plus per account overall (200): strangers can't lock someone out
- [x] Split-made "Owed to me" entries can only change through their expense (server + Loans screen)
- [x] 401 clears cached data and the offline kit; signing in starts with an empty cache
- [x] PIN lock also covers the offline app
- [x] Decimal comma: "12,50" = 12.50; FX rate accepts Arabic digits
- [x] Admin sign-up form waits for the real settings; loading/error states on Admin cards
- [x] Also: reset codes die when the user changes their password; PIN check no longer counts twice in dev
- [x] Sections B-D of the review → alpha 0.6.2 (see Log)

## Phase 2: Android shell (Capacitor) (code in alpha 0.6.5)
- [x] `mobile/` project (Capacitor 8, `appId` **com.budgetme.app**), remote URL mode from `BUDGET_ME_URL`, `allowNavigation` = that host only, HTTPS only, no cloud backup of app data
- [x] Offline fallback page for cold start without network (`mobile/www/`, EN + AR)
- [x] `web/src/native.ts` helper + `@capacitor/core` in web (plugins called by name)
- [ ] Bridge verified on a phone with the current CSP (expected fine: Capacitor injects its bridge natively, not as a page script)
- [ ] App icon + splash from `web/public/icon-*.png` (generated defaults for now)
- [ ] Release keystore created by the owner, stored safely; fingerprint in `MEMORY.md`
- [~] APK builds in CI: debug build on every push (`.github/workflows/android.yml`); signed release on tag `android-v*` once the secrets exist
- [ ] Installed on a real phone, signs in, all tabs work

## Phase 3: Self-update + download link (code in alpha 0.6.5)
- [x] `downloads/` volume (`docker-compose.yml`, read-only, `DOWNLOADS_DIR`)
- [x] `GET /api/app/android/latest`, `GET /api/app/android/apk/:file`, short link `/download/android` (all public: owner chose an open link) + tests (`server/test/appRelease.test.ts`)
- [x] Native plugin (Java `BudgetNativePlugin`): download with progress, verify size + SHA-256 + package + higher versionCode, install via FileProvider, cleanup
- [x] FileProvider `cache/updates/` + `REQUEST_INSTALL_PACKAGES`
- [x] In-app check (launch, every 6 h, on resume, Settings), optional offer vs blocking screen (`mandatory`, `minVersionCode`, server `minNativeVersionCode`), progress, errors EN+AR (`web/src/update.ts`, `components/AndroidApp.tsx`, unit tests)
- [x] "Get the Android app" card in browser Settings + link on the sign-in screen (E2E `android.spec.ts`)
- [x] `mobile/scripts/release.sh` + CI `release` job (sign, check certificate, latest.json, upload APK then manifest, keep 3)
- [ ] Device checklist from `docs/ANDROID_SELF_UPDATE.md` §8

## Phase 4: First-run permissions screen (code in alpha 0.6.5)
- [x] Screen with per-permission rows + "Allow all" + "Skip for now" (`pages/Permissions.tsx`), shown once after the first sign-in in the app
- [x] Notifications, camera, install-unknown-apps; gallery uses the Android photo picker (no permission)
- [x] Permanently denied → "Open settings"; re-checked on resume
- [x] Settings → Reminders → "App permissions" · EN+AR
- [ ] Tried on a phone (allow / deny / permanently denied)

## Phase 5: Native features (code in alpha 0.6.5)
- [x] Camera receipts: "Take a photo" / "From gallery" / "PDF or file" in the app; browser picker unchanged
- [x] Fingerprint/face unlock of the app lock (BiometricPrompt via `BudgetNativePlugin`, PIN fallback, verified once when turned on). Native only, owner's choice 2026-11-21
- [x] Local notifications: 80%/100% budget, recurring due, optional daily reminder (`web/src/notify.ts`, Settings → Reminders, unit tests)
- [x] Save/share exports and backups (share sheet in the app, normal download in the browser)
- [x] Native haptics, Android back button (closes sheets first), "Add expense" home-screen shortcut (`budgetme://add-expense`)
- [ ] Tried on a phone
## Phase 6: Offline viewing
- [x] Persist React Query cache to IndexedDB (`web/src/persist.ts`, official `@tanstack/react-query-persist-client`); cleared on sign-out, 401, forgot-PIN and account deletion (`clearKit`)
- [x] Offline: the app opens from the saved copy with "Showing data from <time>" in the offline bar; new expenses still queue; E2E `e2e/tests/phase6.spec.ts` · committed (0.6.4)

## Phase 7: VPS operations (alpha 0.6.6)
- [x] Encrypted off-site backups: `deploy/backup-offsite.sh` (age public key + any rclone remote, 90 days) + docs (DEPLOY.md "Operations"); target still the owner's choice
- [x] Monthly automated restore test: `deploy/restore-test.sh` (throwaway Postgres, no network, checks tables and accounts)
- [x] Alerts: `deploy/check-health.sh` every 5 min (health, disk > 85%, backup older than 26 h, off-site older than 2 days) via ntfy / Telegram / webhook (all free); outside uptime monitor documented (UptimeRobot / healthchecks.io)
- [x] Rollback `deploy/rollback.sh <ref>`; one-click **Deploy** workflow (tests, then SSH `deploy/update.sh`) once the owner adds SSH secrets; APK publish on tag `android-v*` (Phase 3). No GHCR image: the VPS builds from the repo (simpler for one server)
- [x] Backups only kept when complete (0.6.1); disk encryption documented (depends on the provider)
- [ ] Owner: set up cron, alerts and the off-site target on the VPS (DEPLOY.md "Operations")

## Phase 8: Hardening & cleanup (alpha 0.6.6)
- [x] Two-step sign-in (TOTP authenticator codes + 8 backup codes) for everyone, recommended for admins (Admin page reminds; admins can turn it off for a lost phone)
- [x] Email password reset (done in 0.6.3, owner's request)
- [x] Repo hygiene: no `legacy-flutter/` mention, contact email from `CONTACT_EMAIL`, scripts documented
- [ ] `LICENSE`: owner's choice (none = all rights reserved)
- [~] Dependency majors: done in 0.6.6: React Router 7 (two moderate advisories), Vite 8 + plugin-react 6, Vitest 5 (server + web), Playwright 1.65 (`npm audit`: 0 vulnerabilities in server, web, mobile, e2e). Still as Dependabot PRs, one at a time with green CI: React 19, TypeScript 7, Express 5, express-rate-limit 8, Node 26 image, upload-artifact 7
## Log
- 2026-11-21: Review of alpha 0.5.6 done; hand-off files written; gaps re-prioritised for a personal sideloaded Android app.
- 2026-11-21: Phase 0 + Phase 1 done → alpha 0.6.0 (committed `e83525e`, CI green).
- 2026-11-21: alpha 0.6.2 polish: erase/restore need the password; offline retries answered before caps (and "deleted" items not revived); receipt quota counts the Undo trash and locks; undo checks the quota; backup download is one snapshot; error logs drop DB row details; housekeeping clears expired sessions/codes and old audit entries (`AUDIT_KEEP_DAYS`); overpaid people don't lower loan totals; no duplicate category on retry; month-start change refreshes every report; no lock after camera/file picker; account deletion clears the offline queue; service worker precaches the build (opens offline after first visit) with a per-build cache; "new version" only for a newer server; focus handling in sheets/dialogs; Budget menu closes on tap outside; loading/error states; missing translations; RTL minus in KV rows; tutorial tips; `.gitignore` keystores; README/CODEMAP/CLAUDE fixes. New `server/test/security.test.ts` (10: cross-account, untested routes, offline, quota, housekeeping, headers, CSRF).
- 2026-11-22: **1.2.1**: app only. With `APP_ONLY=true` (production default) browsers get a "Get the app" page (English + Arabic) and only the Android app can use Budget me. Android versionCode 4 (the app now marks its requests).
- 2026-11-22: **1.2.0**: log again, maths in amounts, save buzz, pull to refresh, remembered Expenses filters, category icons and colours, Undo for whole goals and people, month-end summary and 2-weekly money check (Android), home-screen widget (Android), budget rollover and merge repeats (both off by default, sliding switches in Settings → Budget options). Also: language order English · عربي · System, no MK1 badge in the Home header, tutorial tips for all of it. Migration 010. Android versionCode 3. The widget's Java is only compiled by the GitHub Android build.
- 2026-11-22: **1.1.0**: loading screen (logo, name, tagline, hopping dots; also in index.html before the app loads) that fades into Home; signing in always opens Home; rate-limit key uses the library's IPv6 helper (no more startup warning). Android versionCode 2. Server 144, web 30, E2E 58 green; audit 0.
- 2026-11-22: Dependencies: Express 5, express-rate-limit 8, TypeScript 7, React 19, Node 26 (image + CI), upload-artifact v7. CI now starts the built Docker image and checks it answers. Server 141, web 30, E2E 57 green; audit 0.
- 2026-11-22: **1.0.1**: tutorial now 11 steps and covers everything: new Reports step, "Keep your account safe" (email, emailed reset code, two-step sign-in, app lock + fingerprint) and "On your phone" (offline, reminders, self-update, share sheet, shortcut); fixed the old "ask for a reset code" tip. All in Egyptian Arabic. Server 136, web 30, E2E 57 green; npm audit 0 in all four packages.
- 2026-11-22: New colours, theme "Midnight spruce" (Space Indigo, Dark Spruce, Golden Earth) in dark and light, with a matching app icon (web, PWA, Android launcher icons, splash). Earlier palettes tried and dropped: jet/gold/chocolate (too close to Banque Misr).
- 2026-11-22: **MK1 (1.0.0)**: out of alpha (owner's call); "MK1" badge, Settings footer "Developed by Youssef Gouda" + "Budget me MK1 · Version 1.0.0", alpha warnings removed.
- 2026-11-22: alpha 0.6.6 = Phases 7 + 8: off-site backups, restore test, alerts, rollback, Deploy workflow; two-step sign-in; React Router 7; contact email from config. First Android CI build passed (debug APK).
- 2026-11-22: alpha 0.6.5 = Phases 2-5 in code: `mobile/` Capacitor shell + `BudgetNativePlugin` (self-update, fingerprint, app settings), download routes, update flow, permissions screen, camera receipts, reminders, share sheet, back button, shortcut; CI builds the APK. Crash "Reload" now drops the offline copy (bad saved data could crash again). Not yet built or run on a phone.
- 2026-11-22: alpha 0.6.4 = Phase 6 offline viewing (copy kept 7 days, per app version, only the account's own screens).
- 2026-11-22: alpha 0.6.3 (owner's request): sign-up needs an email; new passwords need 8+ chars with lower/upper/number/special (live checklist, "Show" button, no repeat field on sign-up); sign in with username or email; "Forgot password?" emails a one-time code (30 min, 5 tries, 3 mails/address/hour, same answer for unknown addresses) over any SMTP server (free: Gmail app password or Brevo); admin codes still work; Settings → add/change email (needs password). Migration `008_email`. New dependency nodemailer. New env vars `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` (`MAIL_OUTBOX_DIR` dev/test only). Tests: `server/test/email.test.ts` (11), `e2e/tests/email.spec.ts` (3).
- 2026-11-21: Full review written to `docs/REVIEW-2026-11-21.md`; its 8 "fix first" items fixed → alpha 0.6.1. No migration, no new env vars. Added pino (server). New env vars `LOG_LEVEL`, `MIN_NATIVE_VERSION_CODE`. No migration.
