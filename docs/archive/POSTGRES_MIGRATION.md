# Moving Scriptorium from MySQL to PostgreSQL

Scriptorium now stores its data in PostgreSQL (with the `pgvector` extension). This guide moves an
existing MySQL database across. **The MySQL database is only read, never changed**, so you can go
back at any time.

## Before you start

1. In the running (old) app, open **Scholarly tools > Backup** and click **Back up now**, then download
   the ZIP and keep it somewhere safe.
2. Note your last working commit: `1d2ae4f` (the final MySQL version).

## Steps (in the Codespace terminal, one line at a time)

1. `git pull origin main`
2. `pnpm install`
3. `docker compose up -d`
4. `docker compose ps` - wait until `postgres` and `mysql` both say `(healthy)`.
5. Open the file `.env` and make sure it contains these two lines (keep your old MySQL address in the second):

   ```
   DATABASE_URL="postgresql://scriptorium:scriptorium@localhost:5432/scriptorium"
   SCRIPTORIUM_MYSQL_SOURCE_URL="mysql://scriptorium:scriptorium@localhost:3306/scriptorium"
   ```
6. `pnpm prisma:generate`
7. `pnpm prisma:migrate:deploy` - creates the empty PostgreSQL tables.
8. `node scripts/migrate-mysql-to-postgres.mjs --dry-run`
   Rehearsal. Every table should say `match`, and the last line should say the dry run is complete.
9. `node scripts/migrate-mysql-to-postgres.mjs`
   The real copy. It finishes with "every table matched on row count and checksum".
10. `pnpm dev`, then open the app and check your books, highlights and threads.

A report with row counts and checksums is saved as `migration-report-<time>.json` in the project
folder (it is not committed).

## What the copy guarantees

- Every id and timestamp is copied exactly.
- The copy is all-or-nothing: if any table differs by row count or checksum, nothing is kept.
- It refuses to run if PostgreSQL already has data, so it can never merge or overwrite.
- Uploaded files stay where they are (`SCRIPTORIUM_STORAGE_DIR`); only database rows move in this step.

## Going back

Set `DATABASE_URL` in `.env` to the MySQL address again, run `git checkout 1d2ae4f`, then
`pnpm install`, `pnpm prisma:generate` and `pnpm dev`. Nothing in MySQL was altered.

## Things that behave a little differently

- Text search stays case-insensitive, but PostgreSQL treats accented letters as different letters
  (searching `e` no longer finds `é`). This matches the specification's rule that diacritics are meaningful.
- The earlier MySQL migration history is archived in `prisma/migrations-mysql-archive` and is not used.
