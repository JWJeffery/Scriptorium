# Hosting and Database Decision

## Current implementation target

Scriptorium currently targets Prisma with PostgreSQL.

This is reflected in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

## Deployment caution

Do not assume the Spaceship/cPanel database is compatible with the current schema without checking the actual database engine available in the hosting account.

The current schema uses PostgreSQL-oriented choices, including scalar list fields such as `tags String[]`. If the deployment database is MySQL/MariaDB, those fields must be redesigned before deployment.

## Decision rule

Before deploying Scriptorium to Spaceship/cPanel, choose one of these paths:

1. **Keep PostgreSQL**: use hosting/app infrastructure that supports PostgreSQL and a persistent Node/Next.js runtime.
2. **Convert to MySQL/MariaDB**: revise Prisma schema fields that rely on PostgreSQL-only behavior, especially scalar lists.
3. **Split app and database**: host the app where Next.js runs cleanly and use a managed PostgreSQL database elsewhere.

## Current disciplined choice

For Issue #1, keep the current PostgreSQL Prisma model. Do not begin a hosting migration until the PDF annotation persistence path builds and passes verification.
