# Budget me · Version alpha 0.5.6

> **Alpha:** this is an early test version. Features and screens may change between updates, so download a backup now and then (Settings → Download backup).

A mobile web app for managing a budget: monthly budget, expenses, savings goals, loans and yearly reports.
It is built with **React** (Vite, TypeScript) and a **Node.js API** (Express, TypeScript) on **PostgreSQL**, and runs in **Docker**.

Open it on your phone and choose **Add to Home screen**. It installs like an app (PWA): full screen, with its own icon and no browser bar. It is not distributed through any app store.

```
web/        React app (mobile-first UI, installable PWA)
server/     Node API + SQL migrations + API tests
Dockerfile  builds web + server into one small image
docker-compose.yml  app + Postgres, isolated from anything else on the server
legacy-flutter/     the previous Flutter version, kept for reference only (not built or deployed)
```

## Deploy on the VPS (Docker)

**Full step-by-step guide: [DEPLOY.md](DEPLOY.md)** (firewall, secrets, HTTPS proxy, backups, updates).

Short version:

```bash
git clone https://github.com/ygyoussefgouda-art/Budget-Proj.git /opt/budget-me && cd /opt/budget-me
cp .env.example .env && chmod 600 .env && nano .env   # strong POSTGRES_PASSWORD, SIGNUP_INVITE_CODE
docker compose up -d --build
curl http://127.0.0.1:8090/api/health                 # -> {"ok":true}
```

It is a standalone Compose project (`budget-me`) with its own network, Postgres and volume, so it shares nothing with the other app on your VPS. The app listens only on `127.0.0.1:8090`; put your HTTPS reverse proxy in front of it (ready-made configs: [deploy/nginx-budget-me.conf](deploy/nginx-budget-me.conf), [deploy/Caddyfile](deploy/Caddyfile)). Daily database backups go to `backups/`; update with `sh deploy/update.sh`.
### Accounts
Everyone creates their own account on the sign-in screen with **Create account** (username + password). Each account has its own budget, which starts empty, and nobody can see anyone else's data. Passwords are stored as scrypt hashes, sessions expire after 14 idle days (30 at most), and sign-in and sign-up attempts are rate-limited. Set `SIGNUP_INVITE_CODE` so only people you give the code to can sign up. In Settings each user can change their password, sign out everywhere and delete their account.

- Once everyone who should use the app has an account, set `ALLOW_SIGNUP=false` in `.env` and run `docker compose up -d`. The sign-in screen then shows only "Sign in".
- `APP_PASSWORD` (optional) creates a built-in account with the username `owner`. Changing it and restarting signs that account out everywhere.
- **Admin page** (Settings → Admin) for `owner` and the accounts in `ADMIN_USERNAMES`: list accounts (joined, last active, storage used), open/close sign-ups and set the invite code while the app runs, remove an account (type its username + your password), and make **one-time password reset codes** (valid 1 hour, stored hashed). Every admin action is kept in an activity log. Create your account first, then list it in `ADMIN_USERNAMES` (see [DEPLOY.md](DEPLOY.md#admin-page)).
- **Forgot password?** on the sign-in screen: enter the reset code from an admin and a new password; every session of that account is signed out.

The app is built to grow into several users. Every table has a `user_id` and sessions are stored in Postgres, so adding real accounts later needs no data migration. You can also run several app containers behind the proxy, because migrations take a database lock.

## Develop locally

**On this Windows PC:** a portable Node 22 lives in `D:\devtools`. Nothing is installed system-wide. The helper scripts use it:

```bash
scripts\dev-server.cmd
```
That runs the whole app on http://localhost:3000. Use **Create account** to make a local account. The data is kept in `server\.pglite`; delete that folder (with the server stopped) to start over. Rebuild the web app after UI changes with `cd web` then `..\scripts\n.cmd npm run build`. Run any npm command with `scripts\n.cmd`, e.g. `cd server` then `..\scripts\n.cmd npm test`.

**Anywhere else:** requires Node 20+.

```bash
# API with an embedded Postgres (no Docker needed)
cd server
npm install
DB_DRIVER=pglite PGLITE_DIR=.pglite npm run dev      # http://localhost:3000

# React app (proxies /api to :3000)
cd web
npm install
npm run dev                                                                   # http://localhost:5173
```
On Windows PowerShell, set the variables first: `$env:DB_DRIVER='pglite'; $env:PGLITE_DIR='.pglite'; npm run dev`.

Tests:
```bash
cd server
npm test      # API tests against a real (embedded) Postgres
cd web
npm test      # budget maths (the workbook formulas)
```
E2E (Playwright, phone-sized browser against the real app): build the web app, then `cd e2e`, `npm ci`, `npx playwright install chromium`, `npx playwright test`.

GitHub Actions (`.github/workflows/ci.yml`) runs the API, web and E2E tests, a dependency audit and the Docker build on every push. Dependabot opens weekly update PRs.

## What the app does
| Screen | What it does |
|---|---|
| Home | Money left this month and how much you can spend per day until the month ends, income and expenses, savings and debt rings, expense donut, budget usage per category, recent activity. Recurring expenses that are due (Add / Skip). A "+ Expense" button for quick adding (remembers your last category, suggests your usual descriptions). A banner when a category reaches 80% (amber) or 100% (red) of its budget |
| Budget | Per-month income and uni settings (days × weeks × cost), category budgets, savings and loan plans, totals and unallocated income. A new month copies the previous one; an empty month offers "Same as last month". Categories turn amber at 80% and red at 100% of their budget, with a count badge on the Budget tab |
| Expenses | Add, edit and delete expenses (with an optional receipt photo/PDF); search; filter by this month, all time, a date range or a category. Recurring expenses: "every month on day N", with an optional end date, pause, and Add/Skip or add automatically (never added twice). Optional #tags (up to 5; search and filter by tag), "Split with someone" (you record your share, their share becomes an "Owed to me" entry that follows the expense), and "Paid in another currency" (original amount + your rate). Export the current filter to CSV or Excel |
| Loans | "I owe" and "Owed to me", balance per person, history. Warns when you repay more than you owe |
| Savings | Several goals with balance, progress, estimated months to reach each goal and a balance chart. A forecast ("at this pace you'll reach it in March 2027", from the average of the last 3 months) and a "behind plan" hint. You can't withdraw more than a goal holds |
| Reports | Spending per #tag; this month against last month per category ("Food +20%") with the biggest changes; average spending per weekday (Sat–Fri) for this month, the last 3 months or a year; yearly totals, spending vs savings chart, month-by-month table |
| Settings | Contact us (report a bug or suggest a feature by email to youssefgoudawork@gmail.com), app lock (optional 4–6 digit PIN kept only on this phone), currency label, export to CSV / Excel (expenses, loans or savings, any date range; Arabic headers when the app is in Arabic), backup download and restore, sign out, erase all data |

**On the phone:** swipe a row left to delete it (with Undo) or right to edit it, with a light vibration where supported; the buttons stay for keyboard and screen-reader users. With no connection, new expenses are saved on the phone ("Waiting to sync") and sent automatically when you are back online, never twice; the app can even be opened offline to log them. After installing, long-press the app icon for an **Add expense** shortcut.

Deleting a single expense, savings entry or loan entry happens at once, with **Undo** in the message for a few seconds (the receipt comes back too). Bigger deletes (a category, a goal, a person, all data, the account) still ask first.

Money is stored as whole minor units (piastres or cents), so there is no rounding drift. New accounts start completely empty: a first-run tutorial explains each tab, and you set up your own income, categories, goals and loans. To try the app with example data instead (from `Student_Budget.xlsx`), start a brand-new database with `SEED_EXAMPLE_DATA=true`.
