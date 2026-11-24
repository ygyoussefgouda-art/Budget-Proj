# MEMORY.md: project decisions and facts

Long-lived facts for Claude sessions. Add an entry whenever a decision is made or a gotcha is found.
Format: `YYYY-MM-DD: decision/fact. Why. (How to apply.)` Newest at the bottom of each section.

## Product
- 2026-11-21: Budget me is a **personal app** for the owner and a few invited people. Not on Google Play, ever (for now). Why: personal use. (No store assets, no Play policies, no public privacy policy needed.)
- 2026-11-21: Languages: English + Egyptian Arabic, RTL supported. Default theme dark. Default currency label EGP.
- 2026-11-22: **Renamed to Masrofy (مصروفي), 1.3.0, owner's choice.** Logo: "Masrof" + spruce "y" (Arabic "مصروف" + "ي"), `components/Brand.tsx`; slogan unchanged ("Your money, planned."). The name is translated via `t(APP_NAME)`. Technical ids stay "budget-me" / `com.budgetme.app` / `BudgetMeApp` / CSRF value `budget-me`: renaming them would break the deployed VPS (Docker project, volumes, paths) and installed apps. Domain: masrofy.online.
- 2026-11-22: **Email from our own server.** docker-compose `mail` service = Postfix (`boky/postfix:v5.2.1`, a widely used image; reason: the owner wants a mailer daemon on the VPS sending from no-reply@masrofy.online, no third-party account). Send-only, no published port, DKIM keys in the `mailkeys` volume (`DKIM_BACKEND=opendkim` set explicitly). The app talks to it plainly on the private network (`SMTP_REQUIRE_TLS=false`), which `mail.ts` honours only for local hosts (bare service name, localhost); any other SMTP server always needs TLS. `SMTP_HOST=off` turns email off. Deliverability needs port 25 open, PTR, SPF/DKIM/DMARC (DEPLOY.md "Email"). "Forgot password?" accepts the username or email; the code goes to the email on the account.
- 2026-11-21: Budget maths mirror the original `Student_Budget.xlsx` workbook (`web/src/domain/calc.ts`). Don't change formulas without the owner.
- 2026-11-21: Biometrics: the owner removed a browser (WebAuthn) fingerprint unlock earlier, then chose **fingerprint unlock of the app lock in the Android app only** (native BiometricPrompt, HANDOFF Phase 5, PIN as fallback). Why: bank-app feel, reliable on Android. (No WebAuthn/passkeys in the browser; never for sign-in; only offered when a PIN is set.)
- 2026-11-22: **(Replaced on 2026-11-23 by the "Option E" look and mark 11 below.)** **Colours: theme "Midnight spruce"** (owner's pick from Space Indigo #17183B, Dark Spruce #254D32, Golden Earth #A27035). Dark: page #0B0C1F, cards #17183B, buttons #2F6B45 with white text, text-spruce #6FBF8A (`--accent-text`: positive amounts, links, active tab, tints), golden earth #D29A5C for money in / rings, soft red #E07A6F for spending, #B23A3A filled danger. Light: page #F5F5F7, indigo #17183B buttons with white text, spruce #254D32 for money in, #B23A3A spending, indigo text. `--accent` = solid fills only; anything that is text or a tint uses `--accent-text` (`COLORS.accent` points to it). Avoid burgundy + gold (Banque Misr look). Icon: spruce square, off-white bars, tallest bar golden earth, on indigo. Also in `theme.ts`, manifest, PNG icons, Android launcher icons, splash, fallback page.
- 2026-11-22: **MK1 = version 1.0.0**: the owner ended the alpha. The app shows the mark `MK1` under the logo and "Budget me MK1 · Version 1.0.0" in the Settings footer under "Developed by Youssef Gouda" (`web/src/version.ts`: `APP_VERSION`, `MARK`, `DEVELOPER`). No "alpha" anywhere in the app. Next releases: patch/minor numbers as usual; a new mark (MK2) only when the owner says so.
- 2026-11-22: **Express 5** (from Dependabot's 4→5 bump; Express 4 is in maintenance only). The one breaking spot was the page fallback: Express 5 rejects a bare `'*'` route, so it is `app.get('/{*rest}')` (also matches `/`). Other v5 changes checked: `req.body` is undefined without a matching body (all routes Zod-parse it, receipts check `Buffer.isBuffer`), the query parser is "simple" (no nested `a[b]`), and rejected async handlers reach the error handler. New routes: use `/{*name}` or `/*name` wildcards, never `*` or `(.*)`.
- 2026-11-22: **Dependabot batch** (all six PRs done by hand on main, tested together):
  - **express-rate-limit 8**: v8 logs `ERR_ERL_KEY_GEN_IPV6` at startup for a custom key that reads `req.ip`. Since 1.1.0, `ipKey` calls the library's `ipKeyGenerator(ip, 56)`: same /56 IPv6 grouping, and `::ffff:` IPv4 stays per-address (`server/test/ipKey.test.ts`). Watch the E2E server output for such warnings: unit tests don't show them.
  - **TypeScript 7** (native compiler) in server + web: no code change. Checked that it still reports type errors and that the compiled server runs.
  - **React 19** (react, react-dom and both @types together; Dependabot bumped only react-dom, which can't install). One fix: `useRef` objects are typed `RefObject<T | null>` (see `Overlays.tsx`). The bundle grew from about 154 to 177 kB gzipped.
  - **Node 26** (current LTS) in the Docker image *and* in CI test runs, so tests run on the production Node. CI now also starts the built image with Postgres, hardened like production, and checks `/api/health`, the page and a 401. Local dev stays on portable Node 22 (`engines` is `>=20`).
  - **actions/upload-artifact v7**; the Android workflow's checkout/setup-node are on v7 too (same as ci.yml).
- 2026-11-22: **Design skills installed (owner's request)**, project-local in `.claude/skills/` (gitignored, so this PC only): `ui-ux-pro-max` from nextlevelbuilder/ui-ux-pro-max-skill v2.15.0 (MIT; tests left out; `${CLAUDE_PLUGIN_ROOT}` paths changed to `.claude/skills/ui-ux-pro-max`) and `impeccable` from pbakaus/impeccable v4.10.0 (Apache-2.0, `.claude/skills/impeccable` only). Both were read before install: no network calls in UI UX Pro Max's scripts. Impeccable's launcher downloads a checksum-verified `impeccable.exe` engine on first use, so ask the owner first (see CLAUDE.md). Python isn't installed, so UI UX Pro Max's search tool won't run yet.
- 2026-11-22: **Co-author: Mohamed Gouda (`mg-gouda`)**. Invited to the repo with write access, and credited on every commit from now on with `Co-authored-by: Mohamed Gouda <227429699+mg-gouda@users.noreply.github.com>` (GitHub's no-reply address, so GitHub links the account without exposing an email). Earlier commits were not rewritten (that would need a force-push).
- 2026-11-22: **No invite code (owner's request)**. Sign-up needs no invite code any more: removed from the server (`SIGNUP_INVITE_CODE`, `/admin/settings`, `/auth/config.inviteRequired`), the sign-up form and the Admin page; migration `011` deletes a saved code. An old app that still sends `inviteCode` is ignored (Zod strips it). The only gate left is sign-ups open/closed (`ALLOW_SIGNUP` / Admin page). Why: the owner didn't want users asked for a code. Don't re-add it without asking.
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

## 2.0.0 "fintech" update (owner's 10 answers, 2026-11-23)
- **Where it came from:** four Figma community kits: Financy, Fintech Update 1.0, Coinpay, and the dark "Financial Mobile iOS App". Their pages are only readable in a real browser (automated fetches get 403).
- **Owner's answers:**
  1. Dark first, plus pastel accents (sky, lavender, mint, sand, coral, pink; tokens `--sky`… in styles.css, dark ink on them).
  2. Home balance in a full-width **Lime band** (Coinpay-style).
  3. **Quick actions:** Expense, Income, Save, Pay back. They replace the floating button.
  4. **Bottom bar:** Home · Expenses · centre **+** (quick add from any tab, via `/?add=expense`) · Budget · **More**. More (`/more`) holds Savings, Loans, Reports, Settings (and Admin), and its tab stays highlighted on those pages. The E2E helper `tab()` opens Savings/Loans through More.
  5. **Pastel icon circles** for categories with no colour of their own (`pastelFor(name)` in `CategoryIcon.tsx`). A user-picked colour still wins.
  6. **Pastel goal cards:** a sideways strip on Home, and goal rows on the Savings tab.
  7. **Ring chart** ("Where it went") with the total in the middle, then a ranked list.
  8. **Simple line illustrations** (`components/Illustration.tsx`: wallet, receipt, goal) for the first step and every empty list.
  9. **Greeting** "Good morning, {name}" under the month switcher; the logo stays in the header.
  10. **Extras** (owner had no preference; picked here): an "Upcoming payments" card on Home (next 3 recurring) and pill-shaped Deposit/Withdraw buttons.
- **No glow anywhere** (owner): no coloured shadows or halos. Focus shows as a plain solid outline. Neutral drop shadows under menus, toasts and the tutorial stay.
- **Version:** 2.0.0, Android versionCode 6.
## 2026 redesign: owner's "Option E" look (2026-11-23)
- **Where it came from:**
  - The owner chose Option E from the "Masrofy Branding Options" canvas (claude.ai artifact `NKrajw1ozYckw33Dci3vkW`, page "Round 2": "use everything here BUT the logo").
  - It replaces "Midnight spruce" and the short-lived green "flat ledger" palette. The layout from that round stays; its Figma file (https://www.figma.com/design/Jvrii6gRHwPef7riyiDffY) shows the layout in the older green palette.
- **Palette** (`web/src/styles.css`): Night `#0b0f0d` page, Carbon `#171d1a` cards, `#232b27` card2, Lime `#b8f25c` brand, Fog `#8fa39a` muted text.
  - **Dark (default):** lime buttons with night text; lime is the brand text colour.
  - **Light:** page `#edf0ee`, white cards. Night buttons with lime labels. Brand text is `#3e6a0b`, because lime is unreadable on white.
  - **Other colours:** savings blue (`--highlight`), amber for 80%, red only for over budget/errors.
  - **Contrast:** all text tokens are ≥4.78:1 on page/card/card2 in both themes.
- **Meaning of colour:** the brand colour means "good for you" (money in, on track, a debt getting smaller). Ordinary spending is neutral ink, never red. Owing is amber.
- **Fonts:**
  - Manrope for all Latin text (headings 800, tight tracking).
  - **Almarai for Arabic.** New dependency `@fontsource/almarai`, Arabic subset, weights 400/700/800. Reason: it's Option E's Arabic face.
  - Removed: `@fontsource/montserrat` and `@fontsource-variable/cairo`, both no longer used.
- **Tagline:** "See where every pound goes" (Arabic "شوف فلوسك بتروح فين"), from Option E. It replaces "Your money, planned" on the splash, sign-in, README and the "Get the app" page.
- **Home:**
  - Open hero: the number sits on the page with the currency small in the brand colour, and a subline "X used of Y · N days left".
  - The sum (income − spent − saved − repaid) and the per-day amount sit in cards under it.
  - "This week" bar chart (Saturday to Friday, today in lime; current month only, because Home only has this month's expenses).
  - "Where it went" is a stacked bar plus a ranked list.
  - Logo on the left, Reports and Settings on the right.
- **Lists:** each entry is its own rounded Carbon row. Expenses are grouped by day with a per-day total.
- **Sign in:** no boxed card; big logo plus the tagline.
- **Logo (owner, 2026-11-23, "use 11 for now"): mark 11 "Budget line M".**
  - One M stroke drawn like a progress bar: brand colour = spent, quiet part = left.
  - Used in `web/public/icon.svg`, the PWA PNGs, the Android launcher icons (background `#0B0F0D`) and the splash PNGs.
  - In the app, `BrandMark` in `components/Brand.tsx` sits beside the wordmark on Home and sign-in.
  - Regenerate every icon with `node scripts/make-icons.mjs` (uses e2e's Playwright Chromium).
  - The old indigo icon is gone. A new APK is needed for the launcher icon and splash to change on installed phones (versionCode 6).
  - Other candidates stay on the canvas (Options A–F, marks 1–16).
  - **Wordmark rule (owner, 2026-11-23):** the last letter, **y** in Masrofy and **ي** in مصروفي, is always in the secondary colour (Lime; `--accent-text` in the app, which is `#3e6a0b` on light backgrounds).
  - Rounds 4 and 5 are on the canvas; copies are in `design/redesign-2026/logo-round4/`.
- **Not built yet:**
  - From Option E: a centre "+" in the bottom nav (needs 4 tabs; the app has 5).
  - From Figma: category chips instead of the Category dropdown, and folding receipt/split/currency into "More". The E2E tests drive these through the dropdown and visible fields, so they need test updates first.
## Design decisions (whole-app critique, 2026-11-22)
- **Home is a glance screen.**
  - The top card shows the sum (income − spent − saved − repaid = left), so "% used" and the amounts agree.
  - The full category list, and editing it, lives only on the Budget tab.
- **Status logic.** A plan of 0 with nothing done is "No plan" (grey), never "Goal met" (`rowMet` / `rowUnplanned` in `domain/calc.ts`).
- **Computed figures** (per day, averages, paces) are shown in whole units via `wholeUnits` (rounds towards zero).
- **Light-mode colours:** amber `#8a5a00`, red `#9e2f2f`, mute `#62637e`. All are ≥4.5:1 on their tints. Space Indigo stays the light accent (owner's theme).
- **Green means "good for you"**, not "cash in": in Loans, repayments are green and new loans are neutral.
- **Row delete buttons** are quiet grey icons. Removing them needs a delete inside each edit sheet first (keyboard/screen-reader route).
- **Sheets:** a submit button that is the form's last child stays pinned to the bottom (CSS only).

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
- 2026-11-23: Release key on the owner's PC: `D:\keys\masrofy-release.jks` (outside the repo); `mobile/android/keystore.properties` points at it with empty passwords, which are given as env vars at build time. GitHub has the non-secret signing values (`ANDROID_KEY_ALIAS`, `BUDGET_ME_URL`, `EXPECTED_CERT_SHA256`); the owner adds the keystore and the passwords.
- 2026-11-23: Browsers keep a site's tab icon even after the file changes: when the logo changes, bump the `?v=` on the icon links (`index.html`, `get-app.html`, `manifest.webmanifest`).
- 2026-11-24 (owner's request, replaces the 0.6.3 "no repeat field on sign-up"): sign-up and the "Forgot password?" new-password step ask for the password twice ("Repeat password", live match hint), like Settings → Change password. E2E helpers fill it.
- 2026-11-24 (2.1.2): `fmtMoney` joins amount and currency with a no-break space (U+00A0) and `shortDate`/`periodLabel` use no-break spaces too, so "EGP" or a year never wraps alone. E2E regexes must use `\s`, not a literal space, around them (getByText with a string is fine). `HeroAmount` (ui.tsx) is the one way to show a screen's top number.
- 2026-11-24 (2.1.1, owner's choices after the tutorial critique): the first-run tour is 5 short steps where you do things (payday, income, where things are, first expense), all over Home; it ends on Home ("Log an expense" opens quick add, "Later" just closes). Don't grow it back into a feature list: explain features where they live. Android-only features get one "Get the Android app" line in the browser. Esc closes it for now (shown again next time); Skip / finishing marks it done.
- 2026-11-24 (2.1.0, owner chose "Both" after the critique): new accounts get six starter categories (icons, no budget) in the sign-up screen's language (`insertStarterCategories`, `STARTER_CATEGORIES` env, on unless "false"; E2E turns it off), AND Add expense has "+ New category" so an empty account never dead-ends.
- 2026-11-24 (2.1.0): one sign rule everywhere: "+" (money coming to you / into a goal) in green, "−" (going out) in ink. The Home band's breakdown (Spent / Saved / Repaid) has no signs: it is where the income went, not losses. The band's bar fills with what is LEFT.
- 2026-11-24 (2.1.0): Home is a glance: band, quick actions, This week, alerts, goals, upcoming, top-3 "Where it went", recent. The four number tiles and "Budget usage" were removed; the ring is on Reports (`WhereItWent`).
- 2026-11-24 (2.1.0): a goal shows one timeline: with deposits, the real-pace forecast; the "About N months at <plan>" line only before that.
- 2026-11-24 (2.1.0): money in Arabic is wrapped in a left-to-right isolate (U+2066…U+2069) by `fmtMoney`, so "6,000 EGP" never shows as "EGP 6,000". Only when the page is RTL: English text and E2E strings are unchanged.
- 2026-11-24 (2.1.0): expense date = Today / Yesterday / another day chips; the native date input sits invisibly over the third chip (aria-label "Date"), so dates show as "22 Nov", never 11/22/2026.
- 2026-11-24 (2.1.0): form fields use `--field-line` (≥3:1) and every control is ≥44 px to tap (pseudo-element hit areas on chips and small icon buttons).
- 2026-11-23: Owner's request: an Android phone's browser is asked once, before sign-in, to download the app (`AppOffer` in `AndroidApp.tsx`; the answer is kept in localStorage `masrofy.appOffer`). Not shown on iPhone or computers (the APK can't run there), nor inside the app.

## Dependencies added (with reason)
- 2026-11-22: Dev tools upgraded for advisories (they never ship): Vitest 2→5 (server needs `vite` as a dev dependency for it), Vite 5→8, `@vitejs/plugin-react` 4→6, Playwright 1.49→1.65 (run `npx playwright install chromium` after).
- 2026-11-22: `react-router-dom` 6→7 (web): fixes two moderate advisories (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg); library mode, no code changes needed.
- 2026-11-22: `@capacitor/core` (web) and Capacitor 8 packages in `mobile/` (android, app, camera, filesystem, haptics, local-notifications, share, splash-screen, status-bar): the HANDOFF's chosen native shell; all official Capacitor plugins. `androidx.biometric` (Android): Google's library behind BiometricPrompt.
- 2026-11-22: `@tanstack/react-query-persist-client` (web): official add-on of React Query for the Phase 6 offline copy; we wrote the IndexedDB persister ourselves (no idb library).
- 2026-11-22: `nodemailer` (server): sends "Forgot password?" codes over any SMTP server, so the owner can use a free provider (Gmail app password / Brevo free plan); the most used Node mail library, no paid service.
- 2026-11-21: `pino` ^9 (server): structured JSON logging asked for by HANDOFF Phase 1; small, fast, widely used, no transports needed (Docker collects stdout).
