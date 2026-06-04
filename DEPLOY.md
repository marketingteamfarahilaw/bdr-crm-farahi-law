# Deploying the Farahi BD Partner CRM to your VPS

This app runs as **one Node process** that serves both the API and the built
web client. Put a reverse proxy (nginx) in front of it for HTTPS and your
domain. The database is the existing TiDB Cloud instance — you do **not** host
a database on the VPS.

> Replace anything in `<angle brackets>` with your real values.

---

## 1. Prerequisites on the VPS

- **Node.js 20+** (`node -v`)
- **pnpm** via corepack: `corepack enable` (ships with Node)
- **git**
- A domain or subdomain pointing at the VPS (e.g. `crm.farahilaw.com`)

## 2. Get the code and configure

```bash
git clone https://github.com/marketingteamfarahilaw/farahi-lead-scraper.git
cd farahi-lead-scraper
git checkout main            # or the deployed branch

cp .env.example .env
nano .env                    # fill in every value — see the comments in the file
```

Generate a strong session secret for `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

In `.env` make sure of these for production:
- `JWT_SECRET` — a long random string (above)
- `ALLOW_LOCAL_LOGIN="false"` — **must be false/unset** (this is the no-password backdoor)
- `OAUTH_SERVER_URL` / `VITE_OAUTH_PORTAL_URL` — leave unset (keeps password-login mode)
- All the `VITE_*` keys filled in **before** you build (see next step)

## 3. Install and build

```bash
pnpm install                 # installs all deps (build needs the dev tools)
pnpm build                   # → dist/public (client) + dist/index.js (server)
```

> ⚠️ `VITE_*` variables (e.g. `VITE_GOOGLE_MAPS_API_KEY`) are **baked into the
> client at build time**. If you change them later, you must rebuild.

## 4. Seed the first login (so you're not locked out)

With the backdoor off, you log in with an email + password — but no passwords
exist yet. Set the super-admin's password once from the CLI:

```bash
corepack pnpm exec tsx scripts/migration/set-password.ts marketingteam@farahilaw.com "<a-strong-password>"
```

You'll use that to sign in, then set everyone else's password and role from the
**Team & Roles** page inside the app.

## 5. Run it (PM2 — recommended)

```bash
pnpm add -g pm2
NODE_ENV=production pm2 start dist/index.js --name farahi-crm --update-env
pm2 save
pm2 startup            # follow the printed command so it survives reboots
```

Logs: `pm2 logs farahi-crm`  ·  Restart after redeploy: `pm2 restart farahi-crm`

<details><summary>Alternative: systemd unit</summary>

```ini
# /etc/systemd/system/farahi-crm.service
[Unit]
Description=Farahi BD Partner CRM
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/<user>/farahi-lead-scraper
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
User=<user>

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now farahi-crm
```
</details>

The app now listens on `http://127.0.0.1:3000` (or your `PORT`).

## 6. Reverse proxy + HTTPS (nginx)

```nginx
# /etc/nginx/sites-available/farahi-crm
server {
    server_name crm.farahilaw.com;            # <-- your domain
    client_max_body_size 50m;                  # call recordings / uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/farahi-crm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d crm.farahilaw.com      # free HTTPS via Let's Encrypt
```

> The session cookie is marked Secure in production, so the app must be served
> over **HTTPS** for login to work.

## 7. Point external services at the new domain

- **Google Maps API key** — in Google Cloud Console, add your domain
  (`https://crm.farahilaw.com/*`) to the key's HTTP-referrer restrictions, or
  Maps will refuse to load.
- **RingCentral app** — the embedded widget uses RingCentral's official redirect
  page, so no redirect-URI change is usually needed. If you locked the app to
  specific origins, add `https://crm.farahilaw.com`.

## 8. Final security checklist

- [ ] `ALLOW_LOCAL_LOGIN` is **false / unset** in the server `.env`
- [ ] `JWT_SECRET` is a strong unique value (not the dev one)
- [ ] Served over HTTPS (Secure cookies)
- [ ] `.env` is not committed (it's gitignored) and not world-readable (`chmod 600 .env`)
- [ ] Every team member has a password + correct role set on the Team page
- [ ] Duplicate user rows cleaned up (see note below)

## 9. Updating later

```bash
git pull
pnpm install
pnpm build
pm2 restart farahi-crm        # or: sudo systemctl restart farahi-crm
```

---

### Note: duplicate user accounts
Two emails currently have two rows each (`miguelf@` and `youssef@`). Login
deterministically uses the row that has a password set, so set each person's
password on the correct account from the Team page. To fully clean up, delete
the stale duplicate rows once you've confirmed which one holds their data.
