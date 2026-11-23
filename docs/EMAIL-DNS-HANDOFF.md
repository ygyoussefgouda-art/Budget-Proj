# Masrofy email: DNS to add for masrofy.online

Last updated 2026-11-22. **This file holds no secrets.** The DKIM value below is a *public* key, so it's safe to paste and share.

## Why

Masrofy 1.3.0 is live and sends "Forgot password?" codes from **no-reply@masrofy.online**. It sends them through its own mail server on the VPS (the `mail` container, Postfix with DKIM).

The mail server already works: it's running and healthy, and outgoing port 25 is open. Without the records below, though, Gmail, Outlook and others will put these emails in spam or reject them. The records prove the VPS is allowed to send for masrofy.online.

**Where:** Hostinger, which holds the masrofy.online DNS and the VPS.
**Server IP:** `31.97.45.33`

---

## 1. DNS records (Hostinger → Domains → masrofy.online → DNS / Nameservers → Manage DNS records)

Add these **4** records. Leave the TTL at the default (or 3600).

| # | Type | Name (Host) | Value (Points to / Content) |
|---|---|---|---|
| 1 | **A** | `mail` | `31.97.45.33` |
| 2 | **TXT** | `@` | `v=spf1 ip4:31.97.45.33 -all` |
| 3 | **TXT** | `mail._domainkey` | the DKIM value below (one line) |
| 4 | **TXT** | `_dmarc` | `v=DMARC1; p=quarantine; adkim=s; aspf=s` |

**DKIM value for record 3.** Paste it as one line, exactly as shown, with no quotes and no spaces inside the long key:

```
v=DKIM1; h=sha256; k=rsa; s=email; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3mclCOLOrgzFMyhUe6UbuPUJToIgySBec5lx+85GpdRIKmO/RSgKTLewEpxzdMbLA+DpDERjxZYTqxeXJHeGmAUg0NlXL17gFS3ovXnXwUBqqn6ViUUWWbp/DL41KbzSjbFj3+WGJKN13JVVLLEUXf3qDFVUhJJFlSlcSbd9djTTr8/0olQe6yAivZXDTGPg8EjRiY+/ro33elaHhokzo7nWZHOLb7QMEnqmmtrnihJV0hPL/0YjBcqBhgUP/4dhNbBXnoSnaLri4A6RUWw4dTyxj8jR3f85xC2BsCS8MFWmzL2aAWnuej79ZdRAfIHnkRL2tmhFbaNVteDdXSUYcwIDAQAB
```

**Notes:**
- **Don't change the existing records:** A `@` → 31.97.45.33 and CNAME `www` → masrofy.online keep the website working.
- **Only one SPF record is allowed.** On 2026-11-22 masrofy.online had no TXT records at all. If Hostinger already shows a TXT `@` starting with `v=spf1` (for example because Hostinger email was turned on later), add `ip4:31.97.45.33` to that record. Don't create a second one.
- **Optional DMARC reports:** to get daily DMARC reports, add `; rua=mailto:<your own address>` to the end of record 4.
- **If the DKIM key changes:** the key lives in the server's `masrofy_mailkeys` Docker volume. Don't delete that volume. If it's ever recreated, a new key is made, and record 3 must be updated. Print the current key with:
  `ssh masrofy "cd /opt/masrofy && docker compose exec -T mail sh -c 'cat /etc/opendkim/keys/*.txt'"`

---

## 2. Reverse DNS (PTR) for the VPS IP

Receiving servers check that the IP's own name matches the sender. Right now 31.97.45.33 reverses to `srv1626287.hstgr.cloud`.

**Hostinger → VPS → (this server) → Settings / IP address → Reverse DNS (PTR)** → set it to:

```
mail.masrofy.online
```

Do this **after** record 1 (A `mail`) exists. Hostinger checks that the name points back to the IP.

> ⚠️ This VPS also hosts **ilicense.tech** and **transfera.ae**. Changing the PTR only changes the IP's reverse name, which those sites don't use for their web traffic. If either of them **sends email from this same IP**, tell their owner first: one IP has only one PTR name.

---

## 3. Check that it worked (DNS can take a few minutes, up to a few hours)

From any computer:

```sh
nslookup -type=A   mail.masrofy.online           # 31.97.45.33
nslookup -type=TXT masrofy.online                # v=spf1 ip4:31.97.45.33 -all
nslookup -type=TXT mail._domainkey.masrofy.online
nslookup -type=TXT _dmarc.masrofy.online
nslookup 31.97.45.33                             # name = mail.masrofy.online
```

Then the real test:
1. In the Masrofy app, sign out, tap **Forgot password?**, and enter your username or email. Your account must have a Gmail address.
2. In Gmail, open the email, then **⋮ → Show original**. It should say **SPF: PASS**, **DKIM: PASS** and **DMARC: PASS**.
3. If it went to spam, mark it "Not spam" once. New sending domains build trust over the first few days.

**If it doesn't arrive**, look at the server:
```sh
ssh masrofy "cd /opt/masrofy && docker compose logs --tail=50 mail"          # delivery: 'status=sent' or the reason it bounced
ssh masrofy "cd /opt/masrofy && docker compose logs --tail=50 app | grep -i mail"
```

---

## 4. What's already done (no action needed)

- The app (1.3.0) sends through the local `mail` container. The log line says *"plain SMTP to the local mail server (private Docker network only)"*.
- The mail container is healthy, signs every email with DKIM (selector `mail`), publishes no ports and accepts mail only from the app.
- Outgoing port 25 from the VPS is open (checked to Gmail on 2026-11-22).
- Full background: `DEPLOY.md` → "Email ("Forgot password?" codes)".
