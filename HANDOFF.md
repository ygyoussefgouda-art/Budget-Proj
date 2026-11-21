# HANDOFF: Budget me → production-ready personal Android app

> Read this file first. It is the brief for the next Claude session.
> Repo: https://github.com/ygyoussefgouda-art/Budget-Proj (hand-off written at alpha 0.5.6; Phase 0 + 1 done in alpha 0.6.0, see `PROGRESS.md`)
> Companion files (copy them into the repo root on the first commit):
> `CLAUDE.md`, `MEMORY.md`, `PROGRESS.md`, `CODEMAP.md`, `docs/ANDROID_SELF_UPDATE.md`

---

## 1. Goal

Turn the existing **Budget me** PWA (React + Node/Express + PostgreSQL, Docker on a Linux VPS) into a
**production-quality Android app for personal use**:

- **Not on Google Play.** The APK is sideloaded.
- The **app code and database are hosted on the user's Linux VPS** (Docker Compose stack already exists).
- The app offers a **download link** for the APK (on the website and inside the app).
- The app **updates itself**: it checks the VPS for a newer APK, downloads it, verifies it and opens the Android installer.
- On first launch after install, the app **walks the user through every Android permission it needs** and requests them all in one guided flow.

## 2. Hard constraints and decisions already made

| Decision | Detail |
|---|---|
| Distribution | Sideloaded APK only. No Play Store, no store assets, no Play-specific requirements. |
| Users | The owner plus a few invited people (sign-up is invite-code / admin controlled). |
| Hosting | One Linux VPS. Docker Compose project `budget-me`, app on `127.0.0.1:8090`, nginx/Caddy for HTTPS in front. |
| Native wrapper | **Capacitor** (Android only), in a new top-level `mobile/` folder. Do not rewrite the UI. |
| Web loading mode | **Remote URL mode** (`server.url` = the VPS HTTPS address). The APK is a thin native shell around the live site, so **every web deploy updates the app's screens instantly**. A new APK is needed only when native code, plugins, permissions or the icon change. The session cookie, CSRF origin check and `/api` relative paths keep working unchanged because the page origin is the VPS. |
| Self-update | Version manifest + signed APK served by the VPS, checked inside the app. Full spec: `docs/ANDROID_SELF_UPDATE.md`. |
| Permissions | Requested in a first-run "Set up permissions" screen. **Android does not allow granting runtime permissions at install time**, so "grant all on install" is implemented as a guided screen on first launch (plus re-check on each launch). See section 5. |
| Push | No Firebase. Use **local notifications** scheduled on the phone (budget 80%/100% alerts, recurring due, monthly reminder). |
| Money | Stays in integer minor units everywhere. Never introduce floats for money. |
| Languages | English + Egyptian Arabic. Every new UI string must get an Arabic entry in `web/src/i18n-ar.ts`. |

## 3. What the review found (state at hand-off)

**Already good, keep it:** scrypt passwords, Postgres sessions, rate limits (per IP, per account), CSRF header +
Origin check, Helmet CSP, Zod validation, hardened Docker (read-only FS, no caps, non-root), daily `pg_dump`,
migrations with DB lock, CI (API + web + Playwright E2E + audit + Docker build), Dependabot, i18n EN/AR,
offline expense queue with idempotent `clientId`, undo, PIN lock, CSV/XLSX export, backup/restore.

**Missing (re-prioritised for a personal sideloaded app):**

| # | Gap | Priority |
|---|---|---|
| 1 | No native Android app (PWA only) | P0 |
| 2 | No self-update mechanism / download link | P0 |
| 3 | No first-run permissions flow | P0 |
| 4 | ~~No React `ErrorBoundary`: a render error = white screen~~ done in 0.6.0 | P0 |
| 5 | ~~No crash/error reporting, server logs are bare `console.*`~~ done in 0.6.0 | P0 |
| 6 | Backups live on the same VPS, unencrypted, no offsite copy, no restore test | P0 |
| 7 | ~~Service worker: `skipWaiting()` with no "new version, reload" prompt; no client/API version check~~ done in 0.6.0 | P1 |
| 8 | Offline mode can only *add* expenses; nothing can be *viewed* offline | P1 |
| 9 | No notifications (budget alerts, recurring due) | P1 |
| 10 | ~~No biometric unlock (PIN only)~~ dropped: the owner decided against biometrics; PIN only | - |
| 11 | Receipts: web file picker only, no native camera flow | P1 |
| 12 | No uptime/backup-failure alerts | P1 |
| 13 | Manual deploy (`git pull` + rebuild on VPS), no CI-built APK, no rollback | P1 |
| 14 | No disk/volume encryption for data at rest | P2 |
| 15 | No 2FA (at least for admins) | P2 |
| 16 | Account recovery needs an admin reset code (fine for personal use; email reset optional) | P2 |
| 17 | Repo hygiene: README mentions `legacy-flutter/` (not in repo), no `LICENSE`, contact email hard-coded in `ContactCard.tsx`, `scripts/*.cmd` tied to `D:\devtools` | P2 |
| 18 | Older majors: React 18, Vite 5, Express 4, Vitest 2 | P2 |

Dropped because the app is personal and not on Play: store listing, store screenshots, Play data-safety form,
public privacy policy / terms (a short in-app "your data stays on this server" note is enough).

## 4. Work plan (do the phases in order; one branch + PR per phase)

Before starting: clone the repo, create branch `phase-0-handoff`, copy these md files in, run all tests
(`server: npm test`, `web: npm test && npm run build`, `e2e: npx playwright test`) and record the baseline in `PROGRESS.md`.

### Phase 1: Reliability basics (web + server)
- Add a top-level React `ErrorBoundary` (friendly screen, "Reload" button, shows version) in `web/src/main.tsx`.
- Add structured logging on the server (pino, JSON to stdout; request id; never log bodies, passwords, cookies).
- Log unexpected errors in `server/src/http.ts` `errorHandler` with the request id; return the id to the client.
- Add `GET /api/version` → `{ web: "<semver>", api: "<semver>", minNativeVersionCode: <int> }` (public, no auth).
- Service worker update prompt: register with update detection, show "New version ready, Reload" toast,
  only call `skipWaiting` after the user taps it (message `SKIP_WAITING` to `sw.js`). Bump `CACHE` per release.
- Optional: self-hosted error reporting (GlitchTip is Sentry-compatible and can run on the same VPS) or just
  a `POST /api/client-errors` endpoint that logs client crashes (rate-limited, size-limited).
- Tests: API test for `/api/version`; E2E that a thrown render error shows the boundary.

### Phase 2: Android shell (Capacitor)
- New folder `mobile/` with its own `package.json`, `capacitor.config.ts`, and the generated `android/` project.
- `appId`: `me.budget.app` (or the owner's choice, **never change it later**: it is the update identity).
- `server.url` = production HTTPS URL from an env var at build time (`BUDGET_ME_URL`), `cleartext: false`,
  `allowNavigation` limited to that host.
- Bundle a tiny local `www/` fallback page ("Can't reach the server, Retry") for cold start with no network
  when the service worker cache is empty.
- Add `@capacitor/core` to `web/` and a helper `web/src/native.ts` exposing `isNative()` and wrappers, so web
  code calls native features only when running inside the APK (the same build must still work in a browser).
- Verify the Capacitor bridge works in remote mode with the current Helmet CSP (`script-src 'self'`).
  Adjust CSP only if strictly needed and document why in `MEMORY.md`.
- Signing: create one release keystore (see `docs/ANDROID_SELF_UPDATE.md` §6). **Losing it means every user must uninstall and reinstall.**
- `versionCode` = integer that always increases; `versionName` = app semver.
- Build: Gradle `assembleRelease` locally (JDK 21 + Android SDK) **and** in GitHub Actions (preferred).

### Phase 3: Self-update + download link
Implement exactly what `docs/ANDROID_SELF_UPDATE.md` specifies:
- VPS serves `/downloads/android/latest.json` + `budget-me-<versionName>.apk`.
- Server endpoint `GET /api/app/android/latest` (reads the manifest) and an authenticated or open download
  route (decision in the spec).
- In-app: check on launch (max once per 6 h) + "Check for updates" in Settings → download with progress →
  verify SHA-256 → open the system installer. Respect `mandatory` / `minVersionCode`.
- Web: a "Get the Android app" card in Settings (and on the sign-in screen) when *not* running native,
  linking to the latest APK with a short "how to install" guide.
- Release script / CI job: build, sign, compute SHA-256, upload APK + manifest to the VPS, keep last 3 APKs.

### Phase 4: First-run permissions flow
Implement the screen described in section 5. Show it once after install (and again from Settings →
"App permissions"), re-check silently on every launch, never block the app if the user declines.

### Phase 5: Native features that use those permissions
- Receipts: native camera / gallery via `@capacitor/camera` in `web/src/receipt.ts` (keep the web picker path).
- ~~Biometric unlock~~: **dropped by the owner** (no biometric/passkey features). Keep the PIN lock.
- Local notifications: budget category at 80% / 100%, recurring expense due, optional daily "log today's
  expenses" reminder. Computed from data the app already loads; scheduled on the phone.
- Exports/backups: save to Downloads or share sheet (`@capacitor/filesystem` + `@capacitor/share`).
- Haptics via `@capacitor/haptics` instead of `navigator.vibrate` when native.
- Android back button: navigate back / close overlays (`@capacitor/app` `backButton`).
- App shortcut "Add expense" (already in manifest for PWA) as an Android static shortcut.

### Phase 6: Offline viewing
- Persist the React Query cache to IndexedDB (`@tanstack/query-persist-client-core` + an IDB persister),
  scoped per user id, cleared on sign-out / account switch.
- Offline: show last-synced data read-only with a "Last updated <time>" bar; keep the existing add-expense queue.
- Server keeps `Cache-Control: no-store`; the persisted cache lives only in the app's IndexedDB.

### Phase 7: Operations on the VPS
- Offsite encrypted backups: nightly `pg_dump` → `age` encrypt → upload (rclone to B2/S3/another box). Keep
  local 14 days + offsite 90 days. Add `deploy/backup-offsite.sh` + docs.
- Monthly automated restore test into a throwaway container; alert on failure.
- Uptime check of `/api/health` (Uptime Kuma on the VPS or an external free monitor), alert by email/Telegram.
- Alert when the backup job fails or the disk is > 85% full.
- CI/CD: on tag `v*` → run tests → build Docker image (push to GHCR) → build signed APK → deploy to VPS over
  SSH (`deploy/update.sh` pulls the image instead of building) → publish APK + manifest. Keep a rollback
  command (`deploy/rollback.sh <tag>`).
- Enable disk/volume encryption if the VPS provider supports it (document in `DEPLOY.md`).

### Phase 8: Hardening & cleanup (optional, P2)
- TOTP 2FA for admin accounts (then optionally for all).
- Optional email password reset (only if the owner wants an email provider).
- Repo hygiene items from the table (#17), add `LICENSE` (owner's choice), move the contact email to config.
- Dependency major upgrades one at a time, each with green CI.

## 5. First-run permissions screen (spec)

Shown on the first native launch, before or right after sign-in. One screen, one row per permission,
each with an icon, a one-line reason (EN + AR) and a status chip (Allowed / Not allowed / Allow).
A primary button **"Allow all"** requests them one after another; each row can also be tapped alone.
"Skip for now" is always available. Status is re-checked on every resume.

| Permission | Android type | Why the app needs it | How it is granted |
|---|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | install-time (normal) | talk to the VPS, detect offline | automatic at install |
| `VIBRATE` | install-time | haptic feedback on swipe/delete | automatic |
| ~~`USE_BIOMETRIC`~~ | - | not used (biometrics dropped by the owner) | do not add |
| `RECEIVE_BOOT_COMPLETED` | install-time | re-schedule local notifications after reboot | automatic |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | special (Android 12+) | reminders at an exact time (optional; inexact is fine) | prefer inexact alarms and skip this |
| `POST_NOTIFICATIONS` | runtime (Android 13+) | budget alerts, recurring due, update available | system dialog |
| `CAMERA` | runtime | photograph receipts | system dialog |
| `READ_MEDIA_IMAGES` | runtime (13+) | pick receipt photos | **prefer the Android Photo Picker, which needs no permission**; request only if the picker is unavailable |
| `REQUEST_INSTALL_PACKAGES` | special access ("Install unknown apps" for this app) | let the app install its own updates | open `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` for our package, then re-check `canRequestPackageInstalls()` on resume |
| Battery optimisation exemption | special | **not needed**; do not request | none |

Rules: request only what a shipped feature uses; never request storage-wide permissions
(`MANAGE_EXTERNAL_STORAGE`); if a permission was permanently denied, the row's button opens the app's
system settings page instead.

## 6. Definition of done (whole project)

- [ ] Signed APK installs on a real Android phone (Android 10–15), signs in to the VPS, all tabs work.
- [ ] Settings shows app version + "Check for updates"; publishing a new APK on the VPS makes the installed app offer and install it, keeping data and sign-in.
- [ ] Web deploys update the app's UI without a new APK; the "new version, reload" prompt works.
- [ ] Permissions screen works for allow / deny / permanently denied, in English and Arabic (RTL).
- [ ] Camera receipts, local notifications and offline viewing work on device.
- [ ] Encrypted offsite backup runs nightly and a restore test has passed.
- [ ] Uptime + backup alerts reach the owner.
- [ ] CI: tests + Docker image + signed APK on tag; one-command deploy and rollback.
- [ ] `PROGRESS.md`, `MEMORY.md`, `CODEMAP.md`, `DEPLOY.md`, `README.md` are up to date.

## 7. Things to ask the owner before or during the work

1. Production domain (for `server.url` and the download link).
2. Final Android `appId` (cannot change later).
3. APK download: open link, or only for signed-in users? (Spec default: manifest public, APK behind sign-in, plus an optional secret direct link for first install.)
4. Offsite backup target (Backblaze B2, S3, another server) and alert channel (email, Telegram).
5. Where the release keystore + passwords are stored (password manager + offline copy).
6. Whether GitHub Actions may SSH into the VPS (needs a deploy key as a repo secret).

## 8. Working rules for the session
- Follow `CLAUDE.md`. Update `PROGRESS.md` at the end of every phase and `MEMORY.md` whenever a decision is made.
- Keep the browser PWA working at every step: the APK is an addition, not a replacement.
- Never commit secrets: keystore, `keystore.properties`, `.env`, deploy keys.
- Run server, web and E2E tests before every PR; add tests for every new endpoint and screen.
