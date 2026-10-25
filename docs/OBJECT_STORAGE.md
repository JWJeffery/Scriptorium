# Keeping files in object storage

By default Scriptorium keeps uploaded files (the original PDFs, text snapshots and background-job
results) in a folder on the server (`SCRIPTORIUM_STORAGE_DIR`). It can instead keep them in
S3-compatible object storage, which survives redeploys and rebuilds of the server and is easy to
back up. Nothing in the database changes: files keep the same names (keys) either way.

## Moving existing files across (copy-first, safe to repeat)

1. Add the S3 settings from `.env.example` to `.env`, but **leave `SCRIPTORIUM_STORAGE_BACKEND` out for now**.
   For local development with Docker Compose use:
   ```
   SCRIPTORIUM_S3_BUCKET="scriptorium"
   SCRIPTORIUM_S3_ENDPOINT="http://localhost:8333"
   SCRIPTORIUM_S3_CREATE_BUCKET="true"
   ```
2. `docker compose up -d` (starts the local object store).
3. `node scripts/migrate-files-to-s3.mjs --dry-run` - shows what would be copied; writes nothing.
4. `node scripts/migrate-files-to-s3.mjs` - copies each file, reads it back and compares its SHA-256.
   Your local folder is **never** changed or deleted. A file already in the bucket is never overwritten
   unless you add `--overwrite`. The last line says whether everything is clean.
5. Only when it says all files are in the bucket and verified: add `SCRIPTORIUM_STORAGE_BACKEND="s3"` to `.env` and restart.

While the switch is on, any file that is not in the bucket yet is still served from the old folder, so
nothing becomes unreachable. New uploads go to the bucket only.

## Going back

Remove `SCRIPTORIUM_STORAGE_BACKEND` from `.env` and restart. Files uploaded while on S3 are only in
the bucket, so copy them back first if you need them locally.

## Backups and restores

The backup ZIP includes files from whichever backend is active. `node scripts/restore-backup.mjs`
restores files into the bucket when `SCRIPTORIUM_STORAGE_BACKEND=s3` is set, and into the local folder otherwise.

## Choosing a provider for production

Cloudflare R2 (no download fees) or Backblaze B2 (cheapest storage) both speak the S3 protocol; set
`SCRIPTORIUM_S3_ENDPOINT` to the address they give you and `SCRIPTORIUM_S3_REGION="auto"` for R2.
Create the bucket and an access key in their dashboard, restricted to that bucket. Check current
prices on their pages before choosing.

## How it is tested

`scripts/run-live-suite.sh` runs every live check twice in CI: once with local disk and once with
object storage (a moto S3 emulator). `scripts/verify-object-storage.mjs` covers the copy script.
The SeaweedFS container in `docker-compose.yml` is the development object store; it follows the same
S3 protocol, but has not yet been exercised in CI.
