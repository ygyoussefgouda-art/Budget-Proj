# MEMORY.md: project decisions and facts

Long-lived facts for Claude sessions. Add an entry whenever a decision is made or a gotcha is found.
Format: `YYYY-MM-DD: decision/fact. Why. (How to apply.)` Newest at the bottom of each section.

## Product
- 2026-11-21: Budget me is a **personal app** for the owner and a few invited people. Not on Google Play, ever (for now). Why: personal use. (No store assets, no Play policies, no public privacy policy needed.)
- 2026-11-21: Languages: English + Egyptian Arabic, RTL supported. Default theme dark. Default currency label EGP.
- 2026-11-21: Budget maths mirror the original `Student_Budget.xlsx` workbook (`web/src/domain/calc.ts`). Don't change formulas without the owner.
- 2026-11-21: Biometrics: the owner removed a browser (WebAuthn) fingerprint unlock earlier, then chose **fingerprint unlock of the app lock in the Android app only** (native BiometricPrompt, HANDOFF Phase 5, PIN as fallback). Why: bank-app feel, reliable on Android. (No WebAuthn/passkeys in the browser; never for sign-in; only offered when a PIN is set.)
- 2026-11-22: **Colours: theme "Midnight spruce"** (owner's pick from Space Indigo #17183B, Dark Spruce #254D32, Golden Earth #A27035). Dark: page #0B0C1F, cards #17183B, buttons #2F6B45 with white text, text-spruce #6FBF8A (`--accent-text`: positive amounts, links, active tab, tints), golden earth #D29A5C for money in / rings, soft red #E07A6F for spending, #B23A3A filled danger. Light: page #F5F5F7, indigo #17183B buttons with white text, spruce #254D32 for money in, #B23A3A spending, indigo text. `--accent` = solid fills only; anything that is text or a tint uses `--accent-text` (`COLORS.accent` points to it). Avoid burgundy + gold (Banque Misr look). Icon: spruce square, off-white bars, tallest bar golden earth, on indigo. Also in `theme.ts`, manifest, PNG icons, Android launcher icons, splash, fallback page.
- 2026-11-22: **MK1 = version 1.0.0**: the owner ended the alpha. The app shows the mark `MK1` under the logo and "Budget me MK1 · Version 1.0.0" in the Settings footer under "Developed by Youssef Gouda" (`web/src/version.ts`: `APP_VERSION`, `MARK`, `DEVELOPER`). No "alpha" anywhere in the app. Next releases: patch/minor numbers as usual; a new mark (MK2) only when the owner says so.
- 2026-11-22: **Express 5** (from Dependabot's 4→5 bump; Express 4 is in maintenance only). The one breaking spot was the page fallback: Express 5 rejects a bare `'*'` route, so it is `app.get('/{*rest}')` (also matches `/`). Other v5 changes checked: `req.body` is undefined without a matching body (all routes Zod-parse it, receipts check `Buffer.isBuffer`), the query parser is "simple" (no nested `a[b]`), and rejected async handlers reach the error handler. New routes: use `/{*name}` or `/*name` wildcards, never `*` or `(.*)`.
- 2026-11-22: **Dependabot batch** (all six PRs done by hand on main, tested together):
  - **express-rate-limit 8**: v8 logs `ERR_ERL_KEY_GEN_IPV6` at startup for a custom key that reads `req.ip`. Since 1.1.0, `ipKey` calls the library's `ipKeyGenerator(ip, 56)`: same /56 IPv6 grouping, and `::ffff:` IPv4 stays per-address (`server/test/ipKey.test.ts`). Watch the E2E server output for such warnings: unit tests don't show them.
  - **TypeScript 7** (native compiler) in server + web: no code change. Checked that it still reports type errors and that the compiled server runs.
  - **React 19** (react, react-dom and both @types together; Dependabot bumped only react-dom, which can't install). One fix: `useRef` objects are typed `RefObject<T | null>` (see `Overlays.tsx`). The bundle grew from about 154 to 177 kB gzipped.
  - **Node 26** (current LTS) in the Docker image *and* in CI test runs, so tests run on the production Node. CI now also starts the built image with Postgres, hardened like production, and checks `/api/health`, the page and a 401. Local dev stays on portable Node 22 (`engines` is `>=20`).
  - **actions/upload-artifact v7**; the Android workflow's checkout/setup-node are on v7 too (same as ci.yml).
- 2026-11-22: **App only (1.2.1, owner's choice: "I just want an app")**. `APP_ONLY=true` (the docker-compose default) lets only the Android app in: it appends `BudgetMeApp` to its user agent (`mobile/capacitor.config.ts`); browsers get `web/public/get-app.html` and the API answers 403 `app_only`. Open to all: `/api/health`, `/api/version`, `/api/app/android/*`, `/download/android`, the page's own files. It's a convenience, not security (user agents can be faked); every other protection is unchanged. Chosen over packing the screens into the APK (that would mean a new APK per screen change and reworking cookies and the CSRF/Origin check). Local dev and E2E run with it off; set `APP_ONLY=false` to use a browser.
- 2026-11-22: **1.2.0 quality-of-life batch (owner asked for all of it)**. Decisions:
  - **Rollover** (`users.rollover`, off by default; owner approved the maths change): a category's budget = its plan + what carried in. What's left unspent carries on; going over never carries a negative. Looks back 12 months (`server/src/rollover.ts`). Carried money is NOT counted in "Planned total" / "Unallocated income" (it was budgeted from an earlier month's income).
  - **Merge repeats** (`users.merge_repeats`, off by default): a new expense goes into the very last one added if it was within 5 minutes, with the same category, date and description. Never for splits, other currencies, offline syncs (`clientId`) or when a receipt is coming (`noMerge`). The response carries `merged: true`.
  - **Undo** now also covers a whole goal (with its entries) and a whole person in Loans (trash kinds `goal`, `loan_person`). The "Are you sure?" for those is gone.
  - **Category icon/colour**: fixed lists in `validation.ts` (`CATEGORY_ICONS`/`CATEGORY_COLORS`) and `components/CategoryIcon.tsx`; keep them the same. Backups carry them; unknown values in a backup are dropped, not refused.
  - **Amount maths** lives in `parseMoney` (all amount fields): integer minor units, × ÷ by plain numbers, rounded once.
  - **Money notifications** (Android): every 2 weeks (day 14 and 28 of the budget month, 19:00) and a month-end summary (last day, 20:00). Rescheduled with fresh numbers on every open. **No amounts when App lock is on** (notifications and the widget show on the lock/home screen).
  - **Widget**: `BudgetWidget.java` + `updateWidget` plugin method; the text comes from the web app (`web/src/widget.ts`), cleared on sign-out (`clearKit`).
  - Settings switches for account options flip at once and flip back on failure (`SettingSwitch`); owner wants sliding switches with space between them, not tick boxes.
  - Language switch order: **English · عربي · System** (owner's choice). No MK1 badge in the Home header (owner's choice; it stays in Settings and on sign-in).
- 2026-11-22: **Loading screen (1.1.0, owner's picks)**: page background (not a colour block), 80px logo, "Budget me", tagline "Your money, planned" (فلوسك، بخطة), three hopping dots (green/white/gold in dark; spruce/indigo/golden earth in light). Owner rejected a spinning ring and Windows-style spinners. `components/Splash.tsx`; the same markup sits in `web/index.html` so there's no blank screen before the app's code loads (class names only: the CSP blocks inline `style=` there). `SplashExit` fades it out over Home (`pointer-events: none`, removed after 0.5 s). Signing in always opens Home (`nav('/')` in `Login.signedIn`). The Android native splash is the dark page colour.
- 2026-11-22: **Tutorial must cover every feature** (owner asked for it). When you add a user-facing feature, add a tip (or step) in `web/src/components/Tutorial.tsx` with its Arabic, and update the step list in `e2e/tests/auth.spec.ts`. Playwright `getByText('…')` is a case-insensitive substring match: use `{ exact: true }` for step titles.
- 2026-11-21: (history) Alpha versions: one patch number per phase (0.5.2…0.6.6). A short plain summary for the owner after every phase.

## Security decisions (0.6.1)
- 2026-11-21: Admin powers: reset codes and removals need the acting admin's password; admins from `ADMIN_USERNAMES` can't act on other admins, only `owner` can; nobody makes a code for `owner`. Why: one stolen admin session must not take over everyone.
- 2026-11-21: Failed sign-ins: 10 per account+network, 200 per account overall (`accountFailLimit`) per 15 min. Why: a per-account-only limit let anyone lock out any user (incl. owner).
- 2026-11-21: Loan entries with `expense_id` (from a split) are read-only outside their expense: PUT/DELETE `/loans/:id` → 400, deleting that person → 400.
- 2026-11-21: Money input: with no dot, `d,dd` / `d,d` at the end is a decimal comma; any other comma is a thousands separator. Exchange rates: a comma is always decimal (`parseRate`).
- 2026-11-21: Backups are only kept if the plain dump ends with `PostgreSQL database dump complete` (no `pipefail` in `sh`).

## Accounts and email (0.6.3)
- 2026-11-22: Sign-up requires an email (unique, lower-case) and a strong password: 8+ chars with lower, upper, number, special (`passwordProblems` in `server/src/validation.ts` = `PASSWORD_RULES` in `web/src/components/PasswordRules.tsx`; keep them the same). Owner's request with a reference screenshot. Old accounts keep their passwords and may have no email.
- 2026-11-22: Email must be **free**: plain SMTP via nodemailer; documented free options Gmail app password / Brevo. No paid API.
- 2026-11-22: `createApp` defaults to the strict rules; older server tests pass `requireEmail: false, strongPasswords: false` (`setSignupPolicy` is module-level like `setAdminUsernames`). `email.test.ts` covers the strict rules.
- 2026-11-22: No email verification step on sign-up (a typo means that account can't use email reset until fixed in Settings; admins can still make codes).

## Workflow (owner's rules)
- 2026-11-21 (later): the owner asked to **commit and push to GitHub after each finished phase** (tests green first). Before that: never commit or push until the owner says so. Why: the owner reviews first. (This overrides "one branch + PR per phase" in `CLAUDE.md` until the owner asks for branches/PRs. Commit as `ygyoussefgouda-art@users.noreply.github.com`; never put the owner's private email in commits or requests.)
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
- **APK download**: open link (owner's answer 2026-11-21).

## Android app as built (0.6.5)
- 2026-11-22: Native code is one **Java** plugin, `BudgetNativePlugin` (self-update, fingerprint unlock, open app settings), not Kotlin: no Kotlin Gradle plugin to set up, and no third-party code in the update path. Registered in `MainActivity` before `super.onCreate`.
- 2026-11-22: The web app calls Capacitor plugins **by name** (`registerPlugin('Camera')` etc. in `web/src/native.ts`); only `@capacitor/core` is a web dependency. The plugin packages live in `mobile/package.json`.
- 2026-11-22: `allowBackup=false` + data-extraction rules: the PIN hash, offline copy and queued expenses never go to Google backups.
- 2026-11-22: Not verified on a device yet: the APK has only been built by CI. Things to check first: bridge with our CSP, update install, BiometricPrompt, notification permission on Android 13+.

## Operations and two-step sign-in (0.6.6)
- 2026-11-22: Alerts are free channels only (ntfy topic / Telegram bot / webhook) from `deploy/lib.sh`; scripts read `.env` with `load_env` (no `source`, no execution). The alert channel is still the owner's choice.
- 2026-11-22: No GHCR image: the VPS builds from the repo (`deploy/update.sh`). The **Deploy** workflow only SSHes in once the owner adds `VPS`/`VPS_SSH_KEY`/`VPS_KNOWN_HOSTS`.
- 2026-11-22: Two-step sign-in = TOTP in `server/src/totp.ts` (node:crypto only, RFC 6238 vectors tested) + 8 hashed backup codes. Login with it on returns `{ twoFactor, ticket }` (no session) → `POST /auth/login/2fa`. Codes can't be reused (`totp_last_step`). An email password reset does **not** turn it off; an admin can (`/admin/users/:id/disable-2fa`, same rules as reset codes).

## Owner answers (2026-11-21)
- Android `appId` = **`com.budgetme.app`** (never change it: it is the update identity).
- APK download = **open link** (no sign-in needed). Manifest and APK are public; integrity comes from SHA-256 + Android signature checks.
- APK is built in **GitHub Actions** (the owner's PC has no Android SDK). Release signing needs the owner to add the keystore as repo secrets; without them CI builds a debug APK.
- Off-site backups: **target decided later**; `deploy/backup-offsite.sh` works with any rclone remote.

## Open questions (move to a section above once answered)
- Production domain: ? (only needed at APK build time as `BUDGET_ME_URL`)
- Alert channel (email / Telegram): ?
- Where the signing keystore is kept: ?
- Signing certificate SHA-256 fingerprint (not secret): ?
- GitHub Actions allowed to SSH-deploy to the VPS: ?

## Gotchas
- 2026-11-22: React Query `gcTime` is a `setTimeout`: values above ~24.8 days (2^31 ms) overflow and fire at once, dropping cached data. Offline copy uses 7 days. Also store a JSON copy in IndexedDB: the raw dehydrated cache can't be structured-cloned.
- 2026-11-22: Offline copy (IndexedDB `budget-me-cache`) holds the signed-in account's data on the phone; `clearKit()` also deletes it, so every sign-out path must call `clearKit`. Order matters: first set `['me']` to null and remove queries, **then** `await clearKit()` (a late throttled save could otherwise write the signed-in copy back; seen on CI). The `me` query also uses `refetchOnMount: 'always'` so a saved copy never stands in for a real session.
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
- 2026-11-22: Dev tools upgraded for advisories (they never ship): Vitest 2→5 (server needs `vite` as a dev dependency for it), Vite 5→8, `@vitejs/plugin-react` 4→6, Playwright 1.49→1.65 (run `npx playwright install chromium` after).
- 2026-11-22: `react-router-dom` 6→7 (web): fixes two moderate advisories (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg); library mode, no code changes needed.
- 2026-11-22: `@capacitor/core` (web) and Capacitor 8 packages in `mobile/` (android, app, camera, filesystem, haptics, local-notifications, share, splash-screen, status-bar): the HANDOFF's chosen native shell; all official Capacitor plugins. `androidx.biometric` (Android): Google's library behind BiometricPrompt.
- 2026-11-22: `@tanstack/react-query-persist-client` (web): official add-on of React Query for the Phase 6 offline copy; we wrote the IndexedDB persister ourselves (no idb library).
- 2026-11-22: `nodemailer` (server): sends "Forgot password?" codes over any SMTP server, so the owner can use a free provider (Gmail app password / Brevo free plan); the most used Node mail library, no paid service.
- 2026-11-21: `pino` ^9 (server): structured JSON logging asked for by HANDOFF Phase 1; small, fast, widely used, no transports needed (Docker collects stdout).
