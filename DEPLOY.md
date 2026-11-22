# Deploying Budget me to a live VPS

Budget me runs as its **own Docker Compose project** (`budget-me`) with its own network,
its own Postgres and its own volume. It does not touch the other app on your server.
Postgres is never exposed; the app listens only on `127.0.0.1:8090`, and your HTTPS
reverse proxy (nginx or Caddy) forwards your domain to it.

```
Internet ──HTTPS──▶ nginx/Caddy (443) ──▶ 127.0.0.1:8090 ──▶ app container ──▶ db container
                                                              (budget-me network, private)
```

## First launch: do it in this order

With `APP_ONLY=true` (the default) a browser only sees the "Get the app" page, and that page has
nothing to offer until a signed APK is in `downloads/android/`. On a brand-new server:

1. Steps 0-6 below with **`APP_ONLY=false`** in `.env`, so you can open the site in a browser.
2. Create your account, add it to `ADMIN_USERNAMES`, `docker compose up -d`.
3. Make the signing key and add the GitHub secrets ("Android app" below), then push a tag `android-v1.2.1`.
4. Check `https://<your site>/download/android` downloads the APK and it installs and signs in on a phone.
5. Set `APP_ONLY=true`, `docker compose up -d`. Browsers now get the "Get the app" page.
6. Set up the cron jobs, alerts and off-site backups ("Operations" below).

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
nano .env
```

Checklist for `.env`:

| Setting | Production value |
|---|---|
| `POSTGRES_PASSWORD` | random, 16+ chars (the app refuses to start with `change-me…`) |
| `ALLOW_SIGNUP` | `true` while people are joining (anyone who opens the app can sign up; there is no invite code), then `false` |
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
| `CONTACT_EMAIL` | address for Settings → Contact us (empty = the app's default) |
| `APP_ONLY` | `true` (default): only the Android app can use Budget me; a browser shows a "Get the app" page with the download link. `false`: it also works as a website |

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

Open `https://budget.example.com`, create your account, then:

```sh
curl -sI https://budget.example.com | grep -iE 'strict-transport|content-security|x-frame'
curl -sI http://budget.example.com          # → 301 to https
```

You can also run the site through <https://securityheaders.com> and <https://www.ssllabs.com/ssltest/>.

## 7. Backups

- The `backup` container writes a compressed dump of the whole database (all accounts and
  receipts) to `/opt/budget-me/backups` once a day and keeps `BACKUP_KEEP_DAYS` days.
- Make one any time: `sh deploy/backup-now.sh`. Every backup is checked for completeness; an incomplete dump is deleted and reported as `backup: FAILED` (daily, in `docker compose logs backup`) or stops `update.sh` / `restore.sh` before they change anything.
- **Copy backups off the server** (a backup on the same disk doesn't survive losing the VPS):
  `deploy/backup-offsite.sh` sends an encrypted copy every night (see "Operations" below).
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

## Email ("Forgot password?" codes) from no-reply@masrofy.online

New accounts sign up with an email. **Forgot password?** asks for the **username or email**, and emails a
one-time code to the address registered on that account (valid 30 minutes, 5 wrong tries, 3 emails per
account per hour; the screen never says whether an account exists).

**The built-in mail server (default).** `docker compose up -d` also starts the `mail` service: Postfix that
sends as `Masrofy <no-reply@masrofy.online>`, signs every email with DKIM, publishes no port and only accepts
mail from the app. Sending straight from a VPS only reaches inboxes (not spam) with these set up once:

1. **Port 25 outbound.** Many VPS providers block it on new servers. Test from the VPS:
   `nc -vz gmail-smtp-in.l.google.com 25`. If it times out, ask the provider to unblock outgoing port 25.
2. **Reverse DNS (PTR).** In the VPS provider's panel, set the server IP's reverse DNS to `mail.masrofy.online`.
3. **DNS records** at your domain's DNS host (replace `203.0.113.5` with the VPS IP):
   | Type | Name | Value |
   |---|---|---|
   | A | `mail` | `203.0.113.5` |
   | TXT | `@` | `v=spf1 ip4:203.0.113.5 -all` |
   | TXT | `mail._domainkey` | the DKIM key (step 4) |
   | TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:you@your-own-address` |
   (If the domain already has an SPF record, add `ip4:203.0.113.5` to it instead of making a second one.)
4. **DKIM key.** The mail service makes one on first start and keeps it in the `mailkeys` volume:
   `docker compose exec mail sh -c 'cat /etc/opendkim/keys/*.txt'`. Copy the quoted `v=DKIM1; ... p=...` parts
   (joined into one line) into the `mail._domainkey` TXT record. Keep the volume: a new key means a new record.
5. **Check.** Tap **Forgot password?** in the app with your own account, then open the email in Gmail:
   ⋮ → *Show original* should say `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
   Problems: `docker compose logs mail` (delivery) and `docker compose logs app | grep email` (the app's side).

The domain and host name come from `MAIL_DOMAIN` and `MAIL_HOSTNAME` in `.env` (defaults `masrofy.online`,
`mail.masrofy.online`). Replies to no-reply@ are not received: this server only sends.

**Another SMTP server instead** (e.g. Brevo's free plan, 300 emails a day; or Gmail with an app password):
set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_REQUIRE_TLS=true` and `MAIL_FROM` in `.env`.
Codes are only ever sent over an encrypted connection to such servers; `SMTP_REQUIRE_TLS=false` is honoured
only for the built-in `mail` service on the private Docker network.

`SMTP_HOST=off` turns email off: **Forgot password?** then asks for a code from an admin.

Accounts made before 0.6.3 have no email: each person can add one in **Settings → Account**.

## Android app (sideloaded, not on Google Play)

The Android app is a thin shell around this site: every normal deploy updates its screens at once.
A new APK is only needed when the native part changes (plugins, permissions, icon). Details:
[docs/ANDROID_SELF_UPDATE.md](docs/ANDROID_SELF_UPDATE.md).

**App only (`APP_ONLY=true`, the default):** Budget me is used through the Android app, not as a website.
The app marks its requests (`BudgetMeApp` in its user agent); anything else gets the "Get the app" page,
and the API answers it with 403. Health/version checks and the APK download stay open, so people can
still install the app from `https://<your site>`. This keeps people on the app; it is not a security
boundary (a user agent can be faked), so accounts stay protected exactly as before. To test in a
phone or computer browser, run with `APP_ONLY=false`.

**Where the APK lives:** `/opt/budget-me/downloads/android/` on the VPS (mounted read-only into the app):
`latest.json` plus `budget-me-<version>.apk` (the last 3 are kept). People download it from the
"Get the app" page at `https://<your site>` (with `APP_ONLY=true`), or the short link
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

## Operations: off-site backups, restore test, alerts, rollback

Everything here is optional, free, and runs from the VPS's own cron. Settings go in `.env`
(see the "operations" block in `.env.example`).

**1. Alerts (pick one, all free).** Easiest: install the **ntfy** app on your phone, subscribe to a long random
topic name (e.g. `budget-me-7f3k9q2x`), and put `ALERT_NTFY_TOPIC=budget-me-7f3k9q2x` in `.env`. (Or a Telegram
bot: `ALERT_TELEGRAM_BOT_TOKEN` + `ALERT_TELEGRAM_CHAT_ID`; or any `ALERT_WEBHOOK_URL`.)
Test it: `sh -c '. deploy/lib.sh; load_env; alert "test"'`.

**2. Encrypted off-site backups** (a backup on the same disk doesn't survive losing the VPS):
```sh
sudo apt install age && curl https://rclone.org/install.sh | sudo bash
rclone config                       # add a remote: Backblaze B2 (10 GB free), S3, Google Drive, another server (sftp)...
age-keygen -o budget-me-backup.key  # do this on YOUR computer; keep the file in your password manager, NOT on the VPS
```
Put the public key (the `age1...` line) and the remote in `.env`: `OFFSITE_AGE_RECIPIENT=age1...`,
`OFFSITE_REMOTE=b2:my-bucket/budget-me`. Then `sh deploy/backup-offsite.sh` once to check.
To restore from an off-site copy: download it, `age -d -i budget-me-backup.key -o x.sql.gz <file>.age`,
then `sh deploy/restore.sh x.sql.gz`.

**3. Cron** (`crontab -e` as the user that runs Docker; adjust the path):
```
*/5 * * * *  cd /opt/budget-me && sh deploy/check-health.sh       >> backups/ops.log 2>&1
30 3 * * *   cd /opt/budget-me && sh deploy/backup-offsite.sh     >> backups/ops.log 2>&1
0 4 1 * *    cd /opt/budget-me && sh deploy/restore-test.sh       >> backups/ops.log 2>&1
```
`check-health.sh` alerts (at most hourly per problem) when `/api/health` fails, the disk is over
`DISK_ALERT_PERCENT` (85%), no daily backup in 26 hours, or no off-site copy in 2 days.
`restore-test.sh` loads the newest backup into a throwaway Postgres container (no network, nothing of the
running app touched) and checks the tables and accounts; it alerts if anything is wrong.

**4. Uptime from outside** (the VPS can't report its own outage): a free monitor such as UptimeRobot or
healthchecks.io pointed at `https://<your site>/api/health`, alerting by email or the ntfy app.

**5. Rollback.** `sh deploy/rollback.sh <tag or commit>` (see `git log --oneline -15`): backup, switch the code,
rebuild, wait until healthy. Back to the newest: `git checkout main && sh deploy/update.sh`.

**6. One-click deploy from GitHub (optional).** Actions → **Deploy** → Run workflow: runs all tests, then SSHes
in and runs `deploy/update.sh`. Needs repository secrets `VPS` (`user@host`), `VPS_SSH_KEY` (a dedicated key),
`VPS_KNOWN_HOSTS` (`ssh-keyscan <host>`), optionally `VPS_APP_DIR`.

**7. Disk encryption.** If your VPS provider offers encrypted volumes, keep the Docker data (`/var/lib/docker`)
and `/opt/budget-me` on one. Backups leaving the server are always encrypted (step 2).

## Admin page

Admins see **Settings → Admin**: every account (joined, last active, storage used), sign-ups
on/off (overrides `ALLOW_SIGNUP` once saved there),
removing an account (type its username + your password), and **password reset codes**.
Every admin action is written to an activity log on that page.
**Turn on two-step sign-in for every admin account** (Settings → Two-step sign-in, any free authenticator app); the Admin page reminds you until it's on.

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
