# PROGRESS.md

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (say why).
Update at the end of every session. Phases come from `HANDOFF.md` §4.

**Current version:** alpha 0.6.2 · **Current phase:** 1 done + review fixes + polish; next: email sign-up/reset (0.6.3), then 6, 2-5, 7, 8 · **Last updated:** 2026-11-21

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

## Phase 2: Android shell (Capacitor)
- [ ] `mobile/` project, `appId` confirmed, remote URL mode, `allowNavigation` restricted
- [ ] Offline fallback page for cold start without network
- [ ] `web/src/native.ts` helper + `@capacitor/core` in web
- [ ] Bridge verified with current CSP (document result in `MEMORY.md`)
- [ ] App icon + splash from `web/public/icon-*.png`
- [ ] Release keystore created and stored safely; fingerprint in `MEMORY.md`
- [ ] Signed release APK builds locally and in CI
- [ ] Installed on a real phone, signs in, all tabs work · PR merged

Blocked on: production domain, final `appId`, keystore location (open questions in `MEMORY.md`). The owner's PC has only Java 8 (no JDK 21, no Android SDK), so build the APK in CI or install those first.

## Phase 3: Self-update + download link
- [ ] `/opt/budget-me/downloads/android/` + volume mount
- [ ] `GET /api/app/android/latest`, APK route (auth), optional token link + tests
- [ ] Kotlin `ApkUpdater` plugin (download, verify SHA-256 + package + versionCode, install, cleanup)
- [ ] FileProvider + `REQUEST_INSTALL_PACKAGES`
- [ ] In-app check (launch / 6 h / Settings), optional vs mandatory, progress UI, error messages EN+AR
- [ ] "Get the Android app" card in browser Settings + sign-in screen
- [ ] `mobile/scripts/release.sh` + CI `android-release` job
- [ ] Device checklist from `docs/ANDROID_SELF_UPDATE.md` §8 passed · PR merged

## Phase 4: First-run permissions screen
- [ ] Screen with per-permission rows + "Allow all" + "Skip for now"
- [ ] Notifications, camera, install-unknown-apps; Photo Picker for gallery
- [ ] Permanently-denied → open app settings; re-check on resume
- [ ] Settings → "App permissions" entry · EN+AR/RTL · PR merged

## Phase 5: Native features
- [ ] Camera receipts (`@capacitor/camera`), web picker kept
- [ ] Fingerprint/face unlock of the app lock (Android BiometricPrompt, PIN fallback). Native only, owner's choice 2026-11-21; no browser version
- [ ] Local notifications: 80%/100% budget, recurring due, optional daily reminder
- [ ] Save/share exports and backups
- [ ] Native haptics, Android back button, "Add expense" shortcut · PR merged

## Phase 6: Offline viewing
- [ ] Persist React Query cache to IndexedDB per user; clear on sign-out
- [ ] Read-only offline mode with "Last updated" bar · E2E offline test · PR merged

## Phase 7: VPS operations
- [ ] Encrypted offsite backups (`age` + rclone) + docs
- [ ] Monthly automated restore test
- [ ] Uptime monitor + alerts (health, backup failure, disk > 85%)
- [ ] CI/CD: tag → tests → GHCR image → deploy over SSH → APK publish; `deploy/rollback.sh`
- [ ] Disk/volume encryption (if provider supports) · PR merged

## Phase 8: Hardening & cleanup (optional)
- [ ] TOTP 2FA for admins
- [ ] Optional email password reset
- [~] Repo hygiene: README no longer mentions `legacy-flutter/` (done in 0.6.0); LICENSE, contact email to config, scripts still open
- [ ] Dependency major upgrades (React 19, Vite, Express 5, Vitest), one per PR

## Log
- 2026-11-21: Review of alpha 0.5.6 done; hand-off files written; gaps re-prioritised for a personal sideloaded Android app.
- 2026-11-21: Phase 0 + Phase 1 done → alpha 0.6.0 (committed `e83525e`, CI green).
- 2026-11-21: alpha 0.6.2 polish: erase/restore need the password; offline retries answered before caps (and "deleted" items not revived); receipt quota counts the Undo trash and locks; undo checks the quota; backup download is one snapshot; error logs drop DB row details; housekeeping clears expired sessions/codes and old audit entries (`AUDIT_KEEP_DAYS`); overpaid people don't lower loan totals; no duplicate category on retry; month-start change refreshes every report; no lock after camera/file picker; account deletion clears the offline queue; service worker precaches the build (opens offline after first visit) with a per-build cache; "new version" only for a newer server; focus handling in sheets/dialogs; Budget menu closes on tap outside; loading/error states; missing translations; RTL minus in KV rows; tutorial tips; `.gitignore` keystores; README/CODEMAP/CLAUDE fixes. New `server/test/security.test.ts` (10: cross-account, untested routes, offline, quota, housekeeping, headers, CSRF).
- 2026-11-21: Full review written to `docs/REVIEW-2026-11-21.md`; its 8 "fix first" items fixed → alpha 0.6.1. No migration, no new env vars. Added pino (server). New env vars `LOG_LEVEL`, `MIN_NATIVE_VERSION_CODE`. No migration.
