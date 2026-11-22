# CODEMAP.md: where things live

Snapshot of alpha 0.6.3 (2026-11-22). Update when files are added, moved or change purpose.
Items marked **(planned)** don't exist yet; they come from `HANDOFF.md`.

## Top level
| Path | Purpose |
|---|---|
| `web/` | React PWA (mobile-first UI) |
| `server/` | Express API, SQL migrations, API tests |
| `e2e/` | Playwright tests in a phone-sized browser against the real app |
| `mobile/` **(planned)** | Capacitor Android shell, Kotlin `ApkUpdater` plugin, release script |
| `deploy/` | VPS ops: `Caddyfile`, `nginx-budget-me.conf`, `update.sh`, `backup-now.sh`, `restore.sh` |
| `design/` | Design notes + reference images |
| `scripts/` | Windows dev helpers (`dev-server.cmd`, `n.cmd`, `setup-node.cmd`) using portable Node in `D:\devtools` |
| `Dockerfile` | Multi-stage: build web → build server → slim runtime (non-root, health check) |
| `docker-compose.yml` | Project `budget-me`: `db` (Postgres 16), `app`, `backup` (daily `pg_dump`) on an internal network |
| `.env.example` | All production settings (DB password, sign-up, admin, cookies, proxy, quotas, backups) |
| `DEPLOY.md` | Step-by-step VPS guide (firewall, secrets, HTTPS, backups, updates, admin page) |
| `.github/workflows/ci.yml` | CI: server typecheck+tests, web tests+build, npm audit, E2E, Docker build |
| `.github/dependabot.yml` | Weekly dependency PRs |
| `docs/ANDROID_SELF_UPDATE.md` | Spec: APK hosting, download link, self-update (Phase 3) |
| `docs/REVIEW-2026-11-21.md` | Whole-repo review: open gaps by priority (section A fixed in 0.6.1) |
| `CLAUDE.md` / `PROGRESS.md` / `MEMORY.md` / `HANDOFF.md` / `CODEMAP.md` | Working notes: rules, status, decisions, phase plan, this map |

## Server (`server/src/`)
| File | Purpose |
|---|---|
| `index.ts` | Entry: reads env, checks secrets, picks DB driver, runs migrations, creates owner, starts HTTP, trash purge timer, graceful shutdown |
| `app.ts` | `createApp()`: request logger, Helmet/CSP, `no-store` on `/api`, rate limiters (`ipKey`), Origin + CSRF header check, JSON limits, public routes (`/health`, `/version`, `/client-errors`, `/auth/*`), then `requireAuth`, then all routers; serves the SPA with cache headers |
| `mail.ts` | `mailerFromEnv` (SMTP via nodemailer, or `MAIL_OUTBOX_DIR` files for dev/tests), reset-code email text (EN + AR), `sendInBackground` |
| `log.ts` | pino logger (`log`), `APP_VERSION` (from package.json), `requestLogger` (request id + access line), `requestId(res)` |
| `auth.ts` | Login, signup, logout, logout-all, change password, delete account, `requireAuth`, sessions, owner account, admin usernames |
| `admin.ts` | Admin page API: users, sign-up settings, delete user, one-time reset codes, audit log; `/auth/reset` handler |
| `routes.ts` | Main data API: `/state`, `/settings`, `/categories`, `/budget/:month` (+ copy-previous, clear-plans), `/expenses` (+ suggestions), `/tags`, `/goals`, `/goal-entries`, `/loans`, `/loan-people`, `/reports/*` (year, compare, weekdays), `/backup` + `/backup/restore`, `/reset` |
| `recurring.ts` | Monthly recurring rules, due occurrences, add/skip, auto-add |
| `receipts.ts` | `/expenses/:id/receipt` upload/view/delete; file-type sniffing (JPEG/PNG/WebP/PDF); per-account quota |
| `undo.ts` | Deletes move rows to `trash`; `/undo/:id`; `purgeTrash()` |
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
| `seed.ts` | Example data from `Student_Budget.xlsx` (`SEED_EXAMPLE_DATA=true`) |
| `appRelease.ts` **(planned)** | `/api/app/android/latest`, APK download, optional token link |

### Migrations (`server/migrations/`)
`001_init` users, sessions, categories, month_budgets, category_plans, expenses, goals, goal_entries, loan_entries ·
`002_month_start_day` · `003_receipts` · `004_recurring_and_undo` (recurring_rules, recurring_occurrences, trash) ·
`005_tags_split_currency` · `006_offline_client_id` · `007_admin_audit_resets` (app_settings, audit_log, password_resets) · `008_email` (users.email, reset `via`/`attempts`)

### Server tests (`server/test/`)
`api.test.ts` + `phase1..5.test.ts` + `reliability.test.ts` (0.6.0: version, request id, client errors, 500 shape) + `safety.test.ts` (0.6.1: admin limits, reset codes, split-locked loans) + `security.test.ts` (0.6.2) + `email.test.ts` (0.6.3): vitest + supertest against PGlite.

## Web (`web/`)
| Path | Purpose |
|---|---|
| `index.html` | Shell; loads `theme-init.js` before paint |
| `public/manifest.webmanifest` | PWA manifest (standalone, portrait, "Add expense" shortcut) |
| `public/sw.js` | Service worker: shell cache `sb-shell-v4`, cache-first `/assets/`, network-first navigation, never caches `/api`; waits for `SKIP_WAITING` before taking over |
| `public/theme-init.js` | Applies saved theme/language before React loads |
| `public/icon-*.png`, `icon.svg` | App icons (also source for Android icons) |
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
| `offline.ts` | IndexedDB queue for offline expenses, `clientId`, sync, offline kit |
| `pin.ts` | App-lock PIN: PBKDF2 hash in localStorage, lockout backoff |
| `receipt.ts` | Shrinks photos before upload |
| `i18n.tsx` / `i18n-ar.ts` | `t()` with English keys; Arabic dictionary; direction |
| `theme.ts` | Light/dark/system theme |
| `version.ts` | Version label text |
| `styles.css` | All styles, CSS variables for themes |
| `native.ts` **(planned)** | `isNative()` + Capacitor wrappers (camera, biometrics, notifications, haptics, updater) |
| `update.ts` **(planned)** | Android update check / download / install flow |

`pages/`: `Dashboard`, `Budget`, `Expenses` (largest), `Loans`, `Savings` (+ GoalDetail), `Reports`, `Settings`, `Admin`, `Login`.
**(planned)** `Permissions` (first-run permissions screen).

`components/`: `ui` (cards, fields, money input, colours), `Overlays` (toasts, dialogs, undo toast), `BudgetForms`,
`charts`, `ReportCards`, `rows`, `SwipeRow`, `useUndoDelete`, `Recurring`, `Tutorial` (first-run tour), `AppLock` +
`AppLockSettings`, `OfflineApp` + `OfflineQueue`, `ExportLinks`, `MonthStartPicker`, `ContactCard` (contact email constant),
`PasswordRules` (live new-password checklist, `newPasswordError`), `ErrorBoundary` (crash screen with Reload + version), `UpdateBar` ("A new version is ready" Reload / Later).
**(planned)** `UpdateCard` (Android updates), `GetAndroidApp`.

`domain/`: `calc.ts` (workbook formulas, pure) + `calc.test.ts`, `money.ts` (minor units, Arabic digits),
`gestures.ts` (swipe thresholds) + `phone.test.ts`.

## E2E (`e2e/`)
`playwright.config.ts`; `tests/`: `auth`, `contact`, `money`, `settings`, `phase1..5`, `reliability`, `safety`, `email` specs (emails read from `e2e/mail-outbox`), `helpers.ts`; `fixtures/` (receipt image, non-receipt file).

## Mobile (`mobile/`) **(planned)**
| Path | Purpose |
|---|---|
| `capacitor.config.ts` | `appId`, `server.url` from `BUDGET_ME_URL`, `allowNavigation`, fallback `www/` |
| `www/` | Offline/"can't reach server" fallback page |
| `android/` | Generated Android project; `AndroidManifest.xml` permissions, FileProvider, shortcut |
| `android/app/src/main/java/.../ApkUpdaterPlugin.kt` | Self-update plugin |
| `scripts/release.sh` | Build, sign, checksum, upload APK + `latest.json` |
| `version.json` | `versionCode` / `versionName` source of truth |

## On the VPS
`/opt/budget-me/` (repo checkout + `.env`), `backups/` (daily dumps), `downloads/android/` **(planned)**
(`latest.json` + last 3 APKs). Reverse proxy → `127.0.0.1:8090`.
