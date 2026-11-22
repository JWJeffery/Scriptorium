# cPanel MySQL Setup Boundary

This note records the database and file-storage setup required if Scriptorium is deployed into the Spaceship/cPanel environment.

## Current application assumption

Scriptorium now targets MySQL through Prisma.

The app expects a `DATABASE_URL` shaped like:

```text
mysql://USER:PASSWORD@HOST:3306/DATABASE
```

Do not commit real cPanel usernames, passwords, hostnames, database names, or storage paths to the repository.

## cPanel database checklist

In cPanel, create:

1. a MySQL database,
2. a MySQL database user,
3. a strong password,
4. user privileges on the Scriptorium database.

Then set the resulting connection string as the deployment environment variable:

```text
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE
```

## cPanel file-storage checklist

Milestone 1 now has a server-side filesystem storage route for PDF uploads. If the hosting plan supports persistent writable app storage, create a directory for Scriptorium uploads and set:

```text
SCRIPTORIUM_STORAGE_DIR=/absolute/path/to/scriptorium/storage
```

The app stores uploaded PDFs below that directory and records the relative `storageKey` in MySQL.

If cPanel does not provide persistent writable storage for the Node app, use the browser-local fallback temporarily and choose object storage before production use.

## Migration command

Once the production environment has dependencies installed and `DATABASE_URL` set, deploy the schema with:

```bash
pnpm prisma:migrate:deploy
```

## Important boundary

The MySQL database stores scholarly records and file storage keys. The PDF binary is stored on the server filesystem only when `SCRIPTORIUM_STORAGE_DIR` is available and writable.

Do not begin Office conversion, Google Drive import, semantic search, or export systems until the PDF annotation workflow validates end to end.
