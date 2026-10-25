# Running Scriptorium on your own server (Spaceship Starlight VM)

This puts Scriptorium on the internet at an address of your choice, with HTTPS, a sign-in page,
PostgreSQL, the background worker and nightly backups. Everything runs in Docker, from the files in this repository.
Your existing `jwjeffery.org` website and email on shared hosting are not touched.

You will do the parts that need your accounts (create the server, add a DNS record). Everything else is
copy-and-paste commands, one at a time.

## What you need

- A **Starlight VM** (a small Linux server). Choose Ubuntu LTS and a plan with **at least 2 CPU cores and 4 GB of memory**
  (OCR and the search model are hungry; 2 GB will struggle). Check Spaceship's current plans and prices.
- An **address** for the app. Use a subdomain of a domain you own, for example `scriptorium.jwjeffery.org`.
- About an hour the first time.

## 1. Create the server and point your address at it

1. In Spaceship, create the VM (Ubuntu LTS). Add your SSH key if it asks (or use the password it gives you, then switch to a key).
2. Note the VM's **public IP address**.
3. In Spaceship's DNS settings for your domain, add an **A record**: name `scriptorium` (or whichever subdomain you chose),
   value = the VM's IP. Wait a few minutes; `ping scriptorium.yourdomain.org` should answer with that IP.

## 2. Prepare the server (once)

Connect with `ssh root@<the IP>` (or the user Spaceship gave you), then run these one at a time:

```
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh
apt-get -y install ufw git
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

That installs Docker and opens only the SSH, web and secure-web doors.

## 3. Get Scriptorium and set it up

```
git clone https://github.com/JWJeffery/Scriptorium.git /opt/scriptorium
cd /opt/scriptorium
cp .env.production.example .env.production
nano .env.production
```

In the file set:

- `SCRIPTORIUM_DOMAIN` to your address (no `https://`).
- `POSTGRES_PASSWORD`, `SCRIPTORIUM_AUTH_PASSWORD`: long random passwords. You can make one with `openssl rand -base64 24`.
- `SCRIPTORIUM_AUTH_USER`: the username you will sign in with.

Save with Ctrl+O, Enter, then exit with Ctrl+X. This file holds secrets: never commit or share it.

## 4. Start it

```
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The first build takes several minutes. Then check:

```
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

`web` should say `healthy`. Open `https://your-address` in a browser: you should see the Scriptorium sign-in page, with a
padlock (the certificate is fetched automatically; if it fails, the DNS record is usually the cause).

## 5. Move your library onto the server

Do this once, after you have finished the PostgreSQL move on your Codespace (`docs/POSTGRES_MIGRATION.md`).

1. In the Codespace app: **Scholarly tools → Backup → Back up now**, then download the ZIP.
2. Copy it to the server (from your own computer): `scp scriptorium-backup-*.zip root@<the IP>:/opt/scriptorium/`
3. On the server:
   ```
   cd /opt/scriptorium
   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --no-deps -v "$PWD:/restore:ro" web node /app/scripts/restore-backup.mjs /restore/scriptorium-backup-YOURFILE.zip
   ```
   (Use the real file name.) It checks every checksum first and refuses to touch a database that already has books.
4. Reload the site and open **Library**.

## 6. Nightly backups

```
chmod +x deploy/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/scriptorium && ./deploy/backup.sh >> /var/log/scriptorium-backup.log 2>&1") | crontab -
./deploy/backup.sh
```

The last line runs one now; check that two new files appear in `/var/backups/scriptorium`. The newest 14 are kept.
**Backups on the same server do not survive losing the server.** Copy them elsewhere: install `rclone`, run `rclone config`
to add a Cloudflare R2 or Backblaze B2 bucket, and set `RCLONE_REMOTE=remotename:bucket/scriptorium` in the cron line.
Then test a restore on a spare machine at least once.

## 7. Updating

```
cd /opt/scriptorium && git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Database changes apply by themselves. Take a backup first (`./deploy/backup.sh`).

## Going back

Check out the older version (`git checkout <older commit>`) and run the same `up -d --build`. Data changes are additive,
but if an update ever needs undoing, restore the dump taken just before it:
`docker compose ... exec -T postgres pg_restore -U scriptorium -d scriptorium --clean --if-exists < /var/backups/scriptorium/db-XXXX.dump`.

## Useful commands

- Logs: `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f web worker`
- Restart: `docker compose -f docker-compose.prod.yml --env-file .env.production restart`
- Background jobs: sign in, then open `/jobs`.

## How it is tested

GitHub's "Production stack (Docker)" check builds this exact image, starts the whole stack, and runs
`scripts/verify-production-stack.mjs` through the front door: sign-in gate, database setup, an upload, a job run by the
separate worker container, reading its result, and a backup download.
