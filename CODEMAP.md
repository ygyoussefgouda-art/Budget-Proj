# CODEMAP.md: where things live

Snapshot of alpha 0.6.6 (2026-11-22). Update when files are added, moved or change purpose.
Items marked **(planned)** don't exist yet; they come from `HANDOFF.md`.

## Top level
| Path | Purpose |
|---|---|
| `web/` | React PWA (mobile-first UI) |
| `server/` | Express API, SQL migrations, API tests |
| `e2e/` | Playwright tests in a phone-sized browser against the real app |
| `mobile/` | Capacitor 8 Android shell (remote URL mode), `BudgetNativePlugin.java`, release script |
| `deploy/` | VPS ops: `Caddyfile`, `nginx-budget-me.conf`, `update.sh`, `backup-now.sh`, `restore.sh`, `backup-offsite.sh` (age + rclone), `restore-test.sh`, `check-health.sh` (alerts), `rollback.sh`, `lib.sh` (`load_env`, `alert`) |
| `design/` | Design notes, reference images, `screenshots/` (presentation pictures + `overview.png`), `critique/` (Impeccable design reviews: Home, whole app), `redesign-2026/` (before/after screenshots of the 2026 redesign, Option E look; Figma file and branding canvas links in MEMORY.md) |
| `scripts/` | `screenshots.mjs` (demo data + presentation screenshots), Windows dev helpers (`dev-server.cmd`, `n.cmd`, `setup-node.cmd`) using portable Node in `D:\devtools` |
| `Dockerfile` | Multi-stage: build web → build server → slim runtime (non-root, health check) |
| `docker-compose.yml` | Project `budget-me`: `db` (Postgres 16), `app`, `backup` (daily `pg_dump`) on an internal network |
| `.env.example` | All production settings (DB password, sign-up, admin, cookies, proxy, quotas, backups) |
| `DEPLOY.md` | Step-by-step VPS guide (firewall, secrets, HTTPS, backups, updates, admin page) |
| `.github/workflows/ci.yml` | CI: server typecheck+tests, web tests+build, npm audit, E2E, Docker build |
| `.github/workflows/deploy.yml` | Manual one-click deploy: tests (reuses `ci.yml`), then SSH `deploy/update.sh` |
| `.github/workflows/android.yml` | Android: debug APK on push, signed release + publish on tag `android-v*` |
| `.github/dependabot.yml` | Weekly dependency PRs |
| `docs/ANDROID_SELF_UPDATE.md` | Spec: APK hosting, download link, self-update (Phase 3) |
| `docs/store/` | App-store images (Orion Store): `icon-512.png` + 4 phone screenshots from the demo account |
| `LICENSE` | GPL-3.0 |
| `docs/REVIEW-2026-11-21.md` | Whole-repo review: open gaps by priority (section A fixed in 0.6.1) |
| `CLAUDE.md` / `PROGRESS.md` / `MEMORY.md` / `HANDOFF.md` / `CODEMAP.md` | Working notes: rules, status, decisions, phase plan, this map |

## Server (`server/src/`)
| File | Purpose |
|---|---|
| `index.ts` | Entry: reads env, checks secrets, picks DB driver, runs migrations, creates owner, starts HTTP, trash purge timer, graceful shutdown |
| `app.ts` | `createApp()`: request logger, Helmet/CSP, `no-store` on `/api`, rate limiters (`ipKey`), Origin + CSRF header check, JSON limits, public routes (`/health`, `/version`, `/client-errors`, `/auth/*`), then `requireAuth`, then all routers; serves the SPA with cache headers |
| `totp.ts` | TOTP (RFC 6238) + base32 + backup codes, node:crypto only |
| `twoFactor.ts` | Two-step sign-in: login ticket → `/auth/login/2fa`, `/auth/2fa/setup` / `enable` / `disable` |
| `mail.ts` | `mailerFromEnv` (SMTP via nodemailer: the local `mail` Postfix service by default, plain only to local hosts via `isLocalMailHost`; or `MAIL_OUTBOX_DIR` files for dev/tests), sender `DEFAULT_FROM` (Masrofy <no-reply@masrofy.online>), reset-code email text (EN + AR), `sendInBackground` |
| `log.ts` | pino logger (`log`), `APP_VERSION` (from package.json), `requestLogger` (request id + access line), `requestId(res)` |
| `auth.ts` | Login, signup, logout, logout-all, change password, delete account, `requireAuth`, sessions, owner account, admin usernames |
| `admin.ts` | Admin page API: users, sign-up settings, delete user, one-time reset codes, audit log; `/auth/reset` handler |
| `routes.ts` | Main data API: `/state`, `/settings`, `/categories`, `/budget/:month` (+ copy-previous, clear-plans), `/expenses` (+ suggestions), `/incomes` (2.2.0 extra income), `/tags`, `/goals`, `/goal-entries`, `/loans`, `/loan-people`, `/reports/*` (year, compare, weekdays), `/backup` + `/backup/restore`, `/reset` |
| `recurring.ts` | Monthly recurring rules, due occurrences, add/skip, auto-add |
| `receipts.ts` | `/expenses/:id/receipt` upload/view/delete; file-type sniffing (JPEG/PNG/WebP/PDF); per-account quota |
| `undo.ts` | Deletes move rows to `trash` (also a whole goal or loan person); `/undo/:id`; `purgeTrash()` |
| `rollover.ts` | Budget rollover: unspent budget carried in per category (`carryChain` is unit-tested) |
| `backup.ts` | `exportBackup` (one snapshot, JSON v2) and `restoreBackup` (id remapping); the routes are in `routes.ts` |
| `export.ts` | `/export` CSV/XLSX for expenses, loans, savings by date range (Arabic headers); `/reports/tags` |
| `xlsx.ts` | Tiny dependency-free .xlsx writer |
| `validation.ts` | Zod schemas (money, names, passwords ≥10, signup, etc.) |
| `http.ts` | `HttpError`, `ah()` async wrapper, `errorHandler` (Zod/HttpError/PG codes → JSON; logs unexpected errors, 500 body has `requestId`) |
| `db.ts` | `Db` interface; `createPgDb()` (pg pool) and `createPgliteDb()`; transactions; type parsing |
| `migrate.ts` | Runs `server/migrations/*.sql` in order under a database lock (safe with several app containers) |
| `repo.ts` | Row → API shape mappers (camelCase) plus shared queries: `ensureMonth`, `loadBudget`, `expenseWhere`, `goalsWithBalance`, `recentActivity` |
| `dates.ts` | UTC calendar-date helpers |
| `limits.ts` | Per-account caps |
| `activity.ts` | 2.3.0: `noteActivity` (one row per account per day, app/browser) and `usageStats` for the admin area |
| `seed.ts` | Example data from `Student_Budget.xlsx` (`SEED_EXAMPLE_DATA=true`); 2.1.0 starter categories for new accounts (`insertStarterCategories`, `STARTER_CATEGORIES`) |
| `appRelease.ts` | `/api/app/android/latest` + `/api/app/android/apk/:file` (public, name-checked) from `DOWNLOADS_DIR/android` |

### Migrations (`server/migrations/`)
`001_init` users, sessions, categories, month_budgets, category_plans, expenses, goals, goal_entries, loan_entries ·
`002_month_start_day` · `003_receipts` · `004_recurring_and_undo` (recurring_rules, recurring_occurrences, trash) ·
`005_tags_split_currency` · `006_offline_client_id` · `007_admin_audit_resets` (app_settings, audit_log, password_resets) · `008_email` (users.email, reset `via`/`attempts`) · `009_two_factor` (totp columns, backup codes, login challenges) · `010_qol_icons_rollover_undo` · `011_remove_invite_code` (drops the saved invite code) · `012_expense_time_extra_income` (2.2.0: `expenses.time_of_day`, `incomes`, trash kind `income`) · `013_admin_gate_activity` (2.3.0: `sessions.admin_until`, `activity_days`)

### Server tests (`server/test/`)
`api.test.ts` + `phase1..5.test.ts` + `reliability.test.ts` (0.6.0: version, request id, client errors, 500 shape) + `safety.test.ts` (0.6.1: admin limits, reset codes, split-locked loans) + `security.test.ts` (0.6.2) + `email.test.ts` (0.6.3) + `appRelease.test.ts` (0.6.5) + `twoFactor.test.ts` (0.6.6) + `spa.test.ts` (Express 5: static files, page fallback, no hidden-file leaks, APP_ONLY) + `ipKey.test.ts` (rate-limit key per IPv4 / IPv6 /56) + `qol.test.ts` (1.2.0: icons/colours, rollover, merge repeats, Undo for goals/people) + `starterCategories.test.ts` (2.1.0) + `v220.test.ts` (2.2.0: expense time, extra income) + `v230.test.ts` (2.3.0: one admin by email, admin gate, usage counts, audit fixes): vitest + supertest against PGlite.

## Web (`web/`)
| Path | Purpose |
|---|---|
| `index.html` | Shell; loads `theme-init.js` before paint |
| `public/manifest.webmanifest` | PWA manifest (standalone, portrait, "Add expense" shortcut) |
| `public/sw.js` | Service worker: shell cache `sb-shell-v4`, cache-first `/assets/`, network-first navigation, never caches `/api`; waits for `SKIP_WAITING` before taking over |
| `public/theme-init.js` | Applies saved theme/language before React loads |
| `public/icon-*.png`, `icon.svg` | App icons: mark 11 "Budget line M". All PNGs (web + Android launcher + splash) come from `scripts/make-icons.mjs` |
| `public/get-app.html`, `get-app.css` | "Get the Budget me app" page that browsers see when the server runs with `APP_ONLY=true` |
| `vite.config.ts` | Dev proxy `/api` → `:3000`, build to `dist/` |

### `web/src/`
| File | Purpose |
|---|---|
| `main.tsx` | React root: `ErrorBoundary` around QueryClient, Router, I18n, Overlay providers + `UpdateBar`; global error hooks; registers `sw.js` in production |
| `swUpdate.ts` | Service worker registration, update detection (waiting worker or `/api/version` differs), `applyUpdate()`, `useUpdateReady()` |
| `errors.ts` | `reportClientError()` → `POST /api/client-errors`; `watchGlobalErrors()` |
| `App.tsx` | Auth gate, app lock, offline fallback, bottom tabs, routes (`/`, `/budget`, `/expenses`, `/loans`, `/savings`, `/savings/:id`, `/reports`, `/settings`, `/admin`) |
| `api.ts` | `fetch` wrapper: `/api` prefix, CSRF header, `X-Local-Date`, `ApiError` (adds "ref. xxxxxxxx" on server crashes); receipt upload |
| `state.tsx` | The month `/state` query, app context (`useApp`), month/date helpers |
| `offline.ts` | IndexedDB queue for offline expenses, `clientId`, sync, offline kit (`clearKit` also drops the offline copy) |
| `persist.ts` | Offline viewing: IndexedDB persister for the React Query cache (7 days, per version), `KEEP_OFFLINE` keys |
| `pin.ts` | App-lock PIN: PBKDF2 hash in localStorage, lockout backoff |
| `alertsSeen.ts` | 2.2.1: which budget alerts were read (per account, this device), `useSeenAlerts` |
| `receipt.ts` | Shrinks photos before upload |
| `i18n.tsx` / `i18n-ar.ts` | `t()` with English keys; Arabic dictionary; direction |
| `theme.ts` | Light/dark/system theme |
| `version.ts` | Version label text |
| `styles.css` | All styles, CSS variables for themes |
| `native.ts` | `isNative()`, `BudgetNative` + Capacitor plugins by name (camera, notifications, haptics, app, filesystem, share), `haptic`, `saveFile`, `nativeReceiptPhoto` |
| `notify.ts` | Local notifications: budget 80/100%, recurring due, daily reminder, 2-weekly money check, month-end summary (pure parts unit-tested) |
| `widget.ts` | Android home-screen widget text (`widgetText`, no amounts while App lock is on) |
| `update.ts` | Android update check (6 h), `updateNeed` (optional / required), download + install flow (unit-tested) |

`pages/`: `Dashboard`, `Budget`, `Expenses` (largest), `Loans`, `Savings` (+ GoalDetail), `Reports`, `Settings`, `Admin`, `Login`, `More` (2.0.0: the More tab, links to Savings, Loans, Reports, Settings).
`Permissions` (first-run permissions screen, Android app only).

`components/`: `ui` (cards, fields, money input, colours), `Overlays` (toasts, dialogs, undo toast), `Brand` (the "Masrofy"/"مصروفي" logo text + `BrandMark`), `Illustration` (2.0.0 line drawings for empty states), `Splash` (loading screen + `SplashExit` fade into Home; same markup in `index.html`), `CategoryIcon` (category icon/colour badge + picker), `PullToRefresh`, `BudgetForms`, `IncomeSheet` (2.2.0: `IncomePanel` = monthly + extra income, `IncomeForm`),
`charts`, `ReportCards`, `rows`, `SwipeRow`, `useUndoDelete`, `Recurring`, `Tutorial` (first-run tour, 5 steps since 2.1.1; saves payday via `MonthStartPicker` and income via `saveBudget` from `BudgetForms`), `AppLock` +
`AppLockSettings`, `OfflineApp` + `OfflineQueue`, `ExportLinks`, `MonthStartPicker`, `ContactCard` (contact email constant),
`PasswordRules` (live new-password checklist, `newPasswordError`), `ErrorBoundary` (crash screen with Reload + version), `UpdateBar` ("A new version is ready" Reload / Later).
`AndroidApp` (`NativeLayer`: back button / shortcut / resume; `UpdateGate`, `UpdateOffer`, `UpdateCard`, `GetAndroidAppCard`/`Link`), `RemindersCard`, `TwoFactorCard`.

`domain/`: `calc.ts` (workbook formulas, pure) + `calc.test.ts`, `money.ts` (minor units, Arabic digits),
`gestures.ts` (swipe thresholds) + `phone.test.ts`.

## E2E (`e2e/`)
`playwright.config.ts`; `tests/`: `auth`, `contact`, `money`, `settings`, `phase1..5`, `reliability`, `safety`, `email`, `phase6`, `android`, `twofactor`, `onboarding`, `v220` (2.2.0), `v230` (2.3.0 thousands separators) specs (emails read from `e2e/mail-outbox`), `helpers.ts`; `fixtures/` (receipt image, non-receipt file).

## Mobile (`mobile/`)
| Path | Purpose |
|---|---|
| `capacitor.config.ts` | `appId`, `server.url` from `BUDGET_ME_URL`, `allowNavigation`, fallback `www/` |
| `www/` | Offline/"can't reach server" fallback page |
| `android/` | Generated Android project; `AndroidManifest.xml` permissions, FileProvider, shortcut |
| `android/app/src/main/java/com/budgetme/app/BudgetNativePlugin.java` | Self-update, fingerprint unlock, open app settings, widget text |
| `android/app/src/main/java/com/budgetme/app/BudgetWidget.java` | Home-screen widget ("Left today" + Add expense); layout `res/layout/budget_widget.xml` |
| `android/app/src/main/res/xml/` | `shortcuts.xml` (Add expense), `file_paths.xml` (FileProvider), `data_extraction_rules.xml` (no backups) |
| `www/` | Fallback page when the server can't be reached (EN + AR) |
| `scripts/release.sh` | Build, sign, checksum, upload APK + `latest.json` |
| `version.json` | `versionCode` / `versionName` source of truth |

## On the VPS
`/opt/budget-me/` (repo checkout + `.env`), `backups/` (daily dumps), `downloads/android/`
(`latest.json` + last 3 APKs). Reverse proxy → `127.0.0.1:8090`.
