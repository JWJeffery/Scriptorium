# Hosting and Database Decision

## Current implementation target

Scriptorium now targets Prisma with MySQL compatibility for the Spaceship/cPanel deployment path.

This is reflected in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

## Why this changed

If Scriptorium is deployed into the user's Spaceship/cPanel environment, the schema must be compatible with MySQL/MariaDB rather than PostgreSQL-specific features.

Prisma scalar lists are only supported where the database connector supports them natively or at a Prisma level. The earlier `tags String[]` fields were therefore removed from the schema. Tags are now represented by normalized relation tables:

- `AnnotationTag`
- `ResearchThreadTag`

## Current storage boundary

The database now stores scholarly records:

- document metadata,
- document versions,
- source metadata,
- page maps,
- annotations,
- annotation tags,
- citations,
- research threads,
- query logs.

The PDF binary itself remains browser-local for the Milestone 1 prototype. Durable file storage must be decided before deployment.

## Deployment caution

Before deploying to Spaceship/cPanel, confirm:

1. the exact MySQL or MariaDB version,
2. whether Node/Next.js server routes are supported persistently,
3. whether the app should be deployed as a Node app, static export plus separate API, or hosted elsewhere with Spaceship only handling domain/DNS,
4. where durable PDF/object storage will live.

## Current disciplined choice

For Issue #1, continue with the MySQL-compatible Prisma model and do not begin Office files, Google integrations, semantic interrogation, or export systems until the PDF annotation persistence path validates.
