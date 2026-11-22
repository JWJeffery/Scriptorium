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

Spaceship's VPS listens for SSH on **port 22022**, not the usual 22. Connect with `ssh -p 22022 root@<the IP>`,
then run these one at a time:

```
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh
apt-get -y install ufw git
ufw allow 22022/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

That installs Docker and opens only the SSH (22022), web and secure-web doors. Do not use `ufw allow OpenSSH` here:
it opens port 22, and you would lock yourself out of 22022.

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
2. Copy it to the server (from your own computer): `scp -P 22022 scriptorium-backup-*.zip root@<the IP>:/opt/scriptorium/` (note the capital `-P` and port 22022)
3. On the server:
   ```
   cd /opt/scriptorium
   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --no-deps -v "$PWD:/restore:ro" web node /app/scripts/restore-backup.mjs /restore/scriptorium-backup-YOURFILE.zip
   ```
   (Use the real file name.) It checks every checksum first and refuses to touch a database that already has books.
4. Reload the site and open **Library**.

## 6. Housekeeping and nightly backups (once)

```
cd /opt/scriptorium && ./deploy/server-setup.sh
```

This schedules the nightly backup (03:00 server time), keeps its log tidy, and turns on automatic security updates
(the server restarts at 04:30 only when an update needs it; Scriptorium comes back by itself). Do not take Ubuntu's
"new release" upgrade: 24.04 is supported until 2029, and a release upgrade is a job for a fresh snapshot, not a whim.

Then connect the off-server copy to your Google Drive (free): follow `docs/BACKUPS.md`, "Connect Google Drive".
Until you do, the app shows a "Backups need attention" banner, because a backup that lives only on this server
does not survive losing this server.

## 7. Updating

```
cd /opt/scriptorium && ./deploy/update.sh
```

It backs up first and stops if that fails, pulls the new code, rebuilds, waits until the app reports healthy, and
clears out old build leftovers so the disk does not fill. Database changes apply by themselves.

## Going back

Check out the older version (`git checkout <older commit>`) and run
`docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`. Data changes are additive; if an
update ever needs undoing, restore the dump taken just before it with `./deploy/restore.sh /var/backups/scriptorium/db-XXXX.dump`
(see `docs/BACKUPS.md`).

## Useful commands

- Logs: `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f web worker`
- Restart: `docker compose -f docker-compose.prod.yml --env-file .env.production restart`
- Background jobs: sign in, then open `/jobs`.

## How it is tested

GitHub's "Production stack (Docker)" check builds this exact image, starts the whole stack, and runs
`scripts/verify-production-stack.mjs` through the front door: sign-in gate, database setup, an upload, a job run by the
separate worker container, reading its result, and a backup download. It then runs a disaster drill: a real
`deploy/backup.sh` to a stand-in for Google Drive, deleting every volume, `deploy/restore.sh`, and checking that a book,
its exact PDF and its highlight came back (`scripts/verify-restore.mjs`).
