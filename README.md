# Budget me · v0.1.0-alpha

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

This is a standalone Compose project named `budget-me`. It has its own network, its own Postgres container and its own data volume. It shares nothing with the other app already on your VPS, and Postgres is not published to the host.

```bash
# 1. copy this folder to the VPS, e.g. /opt/budget-me, then:
cd /opt/budget-me
cp .env.example .env
nano .env            # set POSTGRES_PASSWORD and APP_PORT (a free port)

# 2. build and start
docker compose up -d --build

# 3. check
docker compose ps
curl http://127.0.0.1:8090/api/health     # -> {"ok":true}
```

By default the app listens on `127.0.0.1:8090` (change it with `APP_PORT`), so only a reverse proxy on the VPS can reach it. Add a site for it to the proxy your other app already uses:

**nginx**
```nginx
server {
    server_name budget.example.com;
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # listen 443 ssl; ... (e.g. certbot --nginx -d budget.example.com)
}
```

**Caddy** (HTTPS is automatic)
```
budget.example.com {
    reverse_proxy 127.0.0.1:8090
}
```

If your proxy runs inside Docker rather than on the host, either set `APP_BIND=0.0.0.0` and point it at `host.docker.internal:8090`, or join the proxy to this project's network (`budget-me_internal`) and proxy to `app:3000`. If you have no domain yet, set `APP_BIND=0.0.0.0` and open `http://<vps-ip>:8090`. Use HTTPS as soon as you can, because the sign-in cookie is only marked secure over HTTPS.

### Update to a new version
```bash
cd /opt/budget-me
# copy the new files in (or git pull), then:
docker compose up -d --build
```
Database migrations run automatically at start-up.

### Backups
- In the app: **Settings → Download backup** saves a JSON file. **Restore from backup** also accepts backups made by the old phone app.
- Full database dump on the VPS:
  ```bash
  docker compose exec -T db pg_dump -U budget_me budget_me > backup-$(date +%F).sql
  ```
  Restore it with:
  ```bash
  docker compose exec -T db psql -U budget_me budget_me < backup-YYYY-MM-DD.sql
  ```

### Accounts
Everyone creates their own account on the sign-in screen with **Create account** (username + password). Each account has its own budget, which starts empty, and nobody can see anyone else's data. Passwords are stored as scrypt hashes, sessions last 30 days, and sign-in and sign-up attempts are rate-limited.

- Once everyone who should use the app has an account, set `ALLOW_SIGNUP=false` in `.env` and run `docker compose up -d`. The sign-in screen then shows only "Sign in".
- `APP_PASSWORD` (optional) creates a built-in account with the username `owner`. Changing it and restarting signs that account out everywhere.

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
GitHub Actions (`.github/workflows/ci.yml`) runs both test suites, builds the web app and builds the Docker image on every push.

## What the app does
| Screen | What it does |
|---|---|
| Home | Money left this month, income and expenses, savings and debt rings, expense donut, budget usage per category, recent activity |
| Budget | Per-month income and uni settings (days × weeks × cost), category budgets, savings and loan plans, totals and unallocated income. A new month copies the previous one |
| Expenses | Add, edit and delete expenses; search; filter by this month, all time, a date range or a category |
| Loans | "I owe" and "Owed to me", balance per person, history. Warns when you repay more than you owe |
| Savings | Several goals with balance, progress, estimated months to reach each goal and a balance chart. You can't withdraw more than a goal holds |
| Reports | Yearly totals, spending vs savings chart, month-by-month table |
| Settings | Currency label, backup download and restore, sign out, erase all data |

Money is stored as whole minor units (piastres or cents), so there is no rounding drift. New accounts start completely empty: a first-run tutorial explains each tab, and you set up your own income, categories, goals and loans. To try the app with example data instead (from `Student_Budget.xlsx`), start a brand-new database with `SEED_EXAMPLE_DATA=true`.
