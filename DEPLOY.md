# Deploying Budget me to a live VPS

Budget me runs as its **own Docker Compose project** (`budget-me`) with its own network,
its own Postgres and its own volume. It does not touch the other app on your server.
Postgres is never exposed; the app listens only on `127.0.0.1:8090`, and your HTTPS
reverse proxy (nginx or Caddy) forwards your domain to it.

```
Internet ──HTTPS──▶ nginx/Caddy (443) ──▶ 127.0.0.1:8090 ──▶ app container ──▶ db container
                                                              (budget-me network, private)
```

## 0. What you need

- A VPS with Docker Engine + the Compose plugin (`docker compose version` works).
- A domain or subdomain, e.g. `budget.example.com`, with an **A record** (and AAAA if you
  use IPv6) pointing to the VPS.
- A reverse proxy already serving your other app (nginx or Caddy). If you have none,
  install Caddy: it handles certificates automatically.

## 1. Firewall (skip if already set)

Only SSH, HTTP and HTTPS should be open. **Do not open 8090 or 5432.**

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> Docker-published ports can bypass ufw. That's why the app binds to `127.0.0.1` only;
> keep `APP_BIND=127.0.0.1`.

## 2. Get the code

```sh
sudo mkdir -p /opt/budget-me && sudo chown "$USER" /opt/budget-me
git clone https://github.com/ygyoussefgouda-art/Budget-Proj.git /opt/budget-me
cd /opt/budget-me
```

## 3. Configure secrets

```sh
cp .env.example .env
chmod 600 .env
openssl rand -base64 32     # → paste as POSTGRES_PASSWORD
openssl rand -hex 8         # → paste as SIGNUP_INVITE_CODE (recommended)
nano .env
```

Checklist for `.env`:

| Setting | Production value |
|---|---|
| `POSTGRES_PASSWORD` | random, 16+ chars (the app refuses to start with `change-me…`) |
| `SIGNUP_INVITE_CODE` | set it, so strangers can't create accounts; share it with your users |
| `ADMIN_USERNAMES` | your own username, after you've created your account (see "Admin page" below) |
| `APP_PORT` | a free port (default `8090`) — must match your proxy config |
| `APP_BIND` | `127.0.0.1` |
| `COOKIE_SECURE` | `true` (requires HTTPS) |
| `HSTS` | `false` if the proxy sends HSTS (the examples do) |
| `TRUST_PROXY` | default works when nginx/Caddy runs on the host; use `1` if exactly one proxy sits in front |
| `LOG_LEVEL` | `info` (default); `debug` only while chasing a problem |
| `MIN_NATIVE_VERSION_CODE` | `0` until the Android app exists |
| `AUDIT_KEEP_DAYS` | `365`: how long the Admin activity log is kept |
| `SMTP_*`, `MAIL_FROM` | email for "Forgot password?" codes (see "Email" below); empty = off |

**Important:** never change `POSTGRES_PASSWORD` after the first start without also changing
it inside Postgres (the database keeps the original password in its volume).

## 4. Start it

```sh
docker compose up -d --build
docker compose ps            # app should become "healthy"
curl -s http://127.0.0.1:8090/api/health
```

## 5. HTTPS reverse proxy

**nginx** (with certbot):

```sh
sudo cp deploy/nginx-budget-me.conf /etc/nginx/sites-available/budget-me
sudo nano /etc/nginx/sites-available/budget-me      # set your domain (and port if changed)
sudo ln -s /etc/nginx/sites-available/budget-me /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d budget.example.com
```

**Caddy**: append `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, set the domain,
then `sudo systemctl reload caddy`.

> If your reverse proxy itself runs **in Docker**, it can't reach `127.0.0.1` on the host.
> Either point it at the host's Docker gateway IP (e.g. `172.17.0.1:8090`) or attach the
> proxy container to the `budget-me_internal` network and proxy to `app:3000`.

## 6. Check it's secure

Open `https://budget.example.com`, create your account (using the invite code), then:

```sh
curl -sI https://budget.example.com | grep -iE 'strict-transport|content-security|x-frame'
curl -sI http://budget.example.com          # → 301 to https
```

You can also run the site through <https://securityheaders.com> and <https://www.ssllabs.com/ssltest/>.

## 7. Backups

- The `backup` container writes a compressed dump of the whole database (all accounts and
  receipts) to `/opt/budget-me/backups` once a day and keeps `BACKUP_KEEP_DAYS` days.
- Make one any time: `sh deploy/backup-now.sh`. Every backup is checked for completeness; an incomplete dump is deleted and reported as `backup: FAILED` (daily, in `docker compose logs backup`) or stops `update.sh` / `restore.sh` before they change anything.
- **Copy backups off the server** (a backup on the same disk doesn't survive losing the VPS),
  e.g. a nightly `rsync`/`rclone` of the `backups/` folder to another machine or cloud storage.
- Restore (replaces everything; asks for confirmation and makes a safety backup first):
  `sh deploy/restore.sh backups/<file>.sql.gz`
- Test a restore occasionally.

Users can also download their own JSON backup in **Settings → Download backup** (receipt
photos are not included in that file).

## 8. Updating

```sh
cd /opt/budget-me
sh deploy/update.sh
```

It backs up the database, pulls the latest code, rebuilds, restarts and waits until the
app is healthy. Database migrations run automatically on start.

## Email ("Forgot password?" codes), free

New accounts sign up with an email. With email set up, **Forgot password?** emails a one-time code
(valid 30 minutes, 5 wrong tries, 3 emails per address per hour; the screen never says whether an address
has an account). Any SMTP server works; two free ones:

**Gmail** (free, about 500 emails a day):
1. On the Google account that sends the mail, turn on 2-Step Verification.
2. Google Account → Security → **App passwords** → create one ("Budget me"). You get 16 letters.
3. In `.env`: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`,
   `SMTP_PASS=<the 16 letters, no spaces>`, `MAIL_FROM=Budget me <you@gmail.com>`.

**Brevo** (free plan, 300 emails a day): create an account, add and verify your sender address, then
SMTP & API → SMTP: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<your SMTP login>`,
`SMTP_PASS=<SMTP key>`, `MAIL_FROM=Budget me <the verified address>`.

Then `docker compose up -d`. Check: on the sign-in screen tap **Forgot password?** and send a code to your own
address. If it doesn't arrive, look in spam and in `docker compose logs app | grep email`.
Without `SMTP_HOST` the app still works: **Forgot password?** then asks for a code from an admin.

Accounts made before 0.6.3 have no email: each person can add one in **Settings → Account**.

## Android app (sideloaded, not on Google Play)

The Android app is a thin shell around this site: every normal deploy updates its screens at once.
A new APK is only needed when the native part changes (plugins, permissions, icon). Details:
[docs/ANDROID_SELF_UPDATE.md](docs/ANDROID_SELF_UPDATE.md).

**Where the APK lives:** `/opt/budget-me/downloads/android/` on the VPS (mounted read-only into the app):
`latest.json` plus `budget-me-<version>.apk` (the last 3 are kept). People download it from
**Settings → Get the Android app** in the browser, the link on the sign-in screen, or the short link
`https://<your site>/download/android`. Installed apps check `/api/app/android/latest` and update themselves.

**Building it (on GitHub, nothing to install at home):**
1. Make the signing key once, on your own computer (keep it forever: losing it means everyone must reinstall):
   `keytool -genkeypair -v -keystore budget-me-release.jks -alias budgetme -keyalg RSA -keysize 4096 -validity 10000`.
   Store the `.jks` and its passwords in your password manager **and** an offline copy. Never commit it.
2. GitHub → repository → Settings → Secrets and variables → Actions → add:
   `ANDROID_KEYSTORE_BASE64` (the .jks, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`budgetme`),
   `ANDROID_KEY_PASSWORD`, `BUDGET_ME_URL` (`https://<your site>`), and to publish automatically: `VPS`
   (`user@host`), `VPS_SSH_KEY` (a key that may only write to the downloads folder), `VPS_KNOWN_HOSTS`.
3. Raise `versionCode` in `mobile/version.json`, commit, then push a tag: `git tag android-v0.7.0 && git push --tags`.
   The **Android** workflow builds, signs, checks the certificate, writes `latest.json` and uploads both.
   Without `VPS` secrets, download the files from the workflow run and copy them to the folder yourself
   (APK first, then `latest.json`).

Every push also builds a test (debug) APK, kept 14 days under the workflow run's artifacts.

## Admin page

Admins see **Settings → Admin**: every account (joined, last active, storage used), sign-ups
on/off and the invite code (these override `ALLOW_SIGNUP` / `SIGNUP_INVITE_CODE` once saved there),
removing an account (type its username + your password), and **password reset codes**.
Every admin action is written to an activity log on that page.

1. Create your own account in the app first.
2. Put its username in `.env`: `ADMIN_USERNAMES=yourname` (comma-separate several), then `docker compose up -d`.
   A listed name that has no account yet is blocked from sign-up, so nobody else can register it.
   The built-in `owner` account (when `APP_PASSWORD` is set) is always an admin.

**Someone forgot their password:** on the Admin page tap the key next to their name and confirm with your own password. Give them the
code (it works once, for 1 hour; only a hash is stored). On the sign-in screen they tap **Forgot password?**,
enter the code and a new password; all their sessions are signed out. If they change their password themselves first, the code stops working.

Admins listed in `ADMIN_USERNAMES` can't make reset codes for, or remove, other admins; only the built-in `owner` can. Nobody can make a code for `owner` (its password is `APP_PASSWORD`).

## 9. Day-to-day

| Task | Command |
|---|---|
| Logs | `docker compose logs -f app` (one JSON line per request/event) |
| Find one error | `docker compose logs app | grep <request id>`: the id a user sees on an error, or from the `X-Request-Id` header |
| Status | `docker compose ps` |
| Restart | `docker compose restart app` |
| Stop everything | `docker compose down` (data stays in the `pgdata` volume) |
| Close sign-ups | on the Admin page (Settings → Admin), or set `ALLOW_SIGNUP=false` in `.env` and `docker compose up -d` |

**Never** run `docker compose down -v` — `-v` deletes the database volume.

## Security built in

- Passwords hashed with scrypt; sessions are random tokens stored hashed, in an
  `HttpOnly; Secure; SameSite=Lax` cookie with idle (14 days) and absolute (30 days) expiry.
- CSRF protection (custom header + Origin check), strict Content-Security-Policy, no caching of API data.
- Rate limits per IP, per account (failed logins) and per user; request size limits; per-account row and receipt quotas.
- Every query is scoped to the signed-in user; all input is validated.
- Receipts are checked by file signature and served sandboxed.
- Container: non-root, read-only filesystem, all Linux capabilities dropped, no privilege escalation, memory/process limits, rotated logs.
- Users can change their password, sign out all devices and delete their account.
- Logs never contain request bodies, passwords, cookies or reset codes; app crashes on phones are reported to the log (message, stack, page path, version only).
