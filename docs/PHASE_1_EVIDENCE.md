# Phase 1: Canonical library foundation - evidence

Recorded 25 October 2026 against `docs/RESEARCH_ENVIRONMENT_SPEC.md`. Status: **built and verified locally; CI and a
trial on the owner's real data are the remaining sign-offs.**

## Work items and where they live

| Work item | Delivered | Evidence |
|---|---|---|
| PostgreSQL + pgvector as the database | Baseline migration, queries audited (case-insensitive search, raw SQL, JSON paths) | Whole live suite runs on PostgreSQL; `prisma migrate diff` reports no drift |
| MySQL to PostgreSQL migration with reconciliation | `scripts/migrate-mysql-to-postgres.mjs`, `docs/POSTGRES_MIGRATION.md` | Row counts and SHA-256 per table, orphan check, sample chains; dry run and all-or-nothing rollback; refuses a non-empty target |
| Item, collection, tag, state, progress model | `Document` extended in place, `DocumentTag`, `Collection`, `ItemCollection`, `SavedSearch`, `/api/v1/items...` | `scripts/verify-library-api.mjs` |
| Checksum duplicate handling | SHA-256 on upload, 409 `duplicate`, browser pre-check, duplicate review | `verify-library-api.mjs`, `e2e-library.mjs` |
| Object storage | S3 backend, copy-first script with read-back verification, restore into a bucket | Whole suite repeated against an S3 emulator; `scripts/verify-object-storage.mjs` |
| Durable queue and workers | pg-boss, `ProcessingJob`, inline or external worker, retries, `/api/v1/jobs` | `verify-jobs-api.mjs`; `verify-worker-recovery.mjs` kills a worker with SIGKILL mid-job and a new one finishes it |
| Library screens | `/library`, `/items/<id>`, `/jobs`, `/inbox` (reserved) | `scripts/e2e-library.mjs` in real Chromium |
| Preservation contract | Existing verifiers, security gate, backup and restore (now including the new tables) all green | `run-live-suite.sh` on both storage backends |

## Spec "done when" for Phase 1

- *Two browsers show the same library and progress*: state, collections, tags and reading position are stored on the server; the reader resumes from the server's position. Verified through the API and the browser test.
- *Refresh/offline recovery cannot create silent divergence*: the database remains the authority (existing `mergeServerRecords` rules); local-only records are still offered for saving, never overwritten.
- *Duplicate upload is handled predictably*: refused with a clear message unless the reader chooses to add it.
- *Workers survive restart*: recovery test above.
- *Existing annotation, page-mapping, citation and export tests remain green*: yes, on both storage backends.

## Migration and rollback

- Take a backup first (Scholarly tools > Backup), then follow `docs/POSTGRES_MIGRATION.md`. MySQL is only read, so rollback is `git checkout 1d2ae4f`, restore the old `DATABASE_URL`, and restart.
- File moves are copy-first (`docs/OBJECT_STORAGE.md`); the local folder is never changed.
- All schema changes are additive after the PostgreSQL baseline (`20261025030000_library_foundation`, `20261025040000_processing_jobs`).

## Known gaps carried forward

- Per-user accounts and ownership (single owner for now); idempotency keys on repeated writes.
- Threads and exports still reference deleted books by design; they are not hidden there.
- The SeaweedFS container in `docker-compose.yml` has not been exercised (tests use an S3 emulator).
- Nested collections are reserved in the schema but not exposed.
- Not yet run on the owner's real library: the MySQL copy and the new screens on a real scanned book.
