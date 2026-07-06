# cPanel MySQL Setup Boundary

This note records the database setup required if Scriptorium is deployed into the Spaceship/cPanel environment.

## Current application assumption

Scriptorium now targets MySQL through Prisma.

The app expects a `DATABASE_URL` shaped like:

```text
mysql://USER:PASSWORD@HOST:3306/DATABASE
```

Do not commit real cPanel usernames, passwords, hostnames, or database names to the repository.

## cPanel setup checklist

In cPanel, create:

1. a MySQL database,
2. a MySQL database user,
3. a strong password,
4. user privileges on the Scriptorium database.

Then set the resulting connection string as the deployment environment variable:

```text
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/DATABASE
```

## Migration command

Once the production environment has dependencies installed and `DATABASE_URL` set, deploy the schema with:

```bash
pnpm prisma:migrate:deploy
```

## Important boundary

The current Milestone 1 workflow still stores the PDF binary in browser IndexedDB. The MySQL database stores scholarly metadata and annotation records, not the PDF file itself.

Before production deployment, choose durable file storage for PDFs. Options include:

- filesystem storage if the hosting plan supports persistent app-writable storage,
- object storage outside cPanel,
- database BLOB storage only if intentionally accepted despite likely performance and backup drawbacks.

Do not begin Office conversion, Google Drive import, semantic search, or export systems until the PDF annotation workflow validates end to end.
