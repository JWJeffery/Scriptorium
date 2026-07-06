# Milestone 1 CI Fix Branch

This branch exists to finish Issue #1 verification without more direct-to-main CI churn.

Scope remains limited to Milestone 1:

- verify MySQL-compatible Prisma schema and migration,
- verify PDF.js selection/anchor workflow,
- verify document/page-map/annotation/citation persistence,
- verify server PDF upload/retrieval path,
- fix typecheck and build failures until CI is green.

Non-goals:

- Office files,
- Google Drive or Google Workspace integration,
- semantic interrogation,
- export systems,
- deployment to Spaceship/cPanel.

## Verification

PR-triggered Scriptorium CI run `28820387682` completed successfully.

That run verifies:

- Milestone 1 fixture coherence,
- TypeScript typecheck,
- Next.js build,
- Prisma validation,
- Prisma Client generation,
- MySQL migration deploy against a real MySQL service.
