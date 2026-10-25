# Background jobs and the worker

OCR, page splitting and building the by-meaning index can each take minutes. They no longer run inside
a web request: each is **queued**, recorded, and worked by a worker, one heavy job at a time.

## What you will notice

- Asking for OCR, a split or an index while another is running now **queues** it (before, it was refused).
- Progress bars read from the database, so they stay correct across a page reload or a server restart.
- A job that fails is retried once automatically. If it still fails it is recorded as failed, with the reason,
  and can be run again.
- A job that was running when the server or worker died is noticed (within about a minute) and retried.
- Asking for the same job twice while it is queued or running does nothing extra.

## Where the work runs

| Mode | Setting | How |
|---|---|---|
| **Inline** (default) | nothing | The web server also works the queue. `pnpm dev` or `next start` is all you need. |
| **External** | `SCRIPTORIUM_WORKER_MODE=external` on the web server | The web server only queues jobs. Run `pnpm worker` as a separate process (a second terminal, or a second container/service in production). |

Do not run an external worker against a web server left in inline mode: both would work the queue.
The worker needs the same `.env` (database and file-storage settings) as the web server.

## Seeing the queue

- `GET /api/v1/jobs` lists jobs (filter with `?state=failed`, `?type=ocr|page-split|embed-index`, `?subjectId=...`).
- `GET /api/v1/jobs/<id>` shows one; `POST /api/v1/jobs/<id>/retry` runs a failed job again as a new job.

## Settings (all optional)

| Variable | Default | Meaning |
|---|---|---|
| `SCRIPTORIUM_WORKER_MODE` | `inline` | `inline` or `external` |
| `SCRIPTORIUM_JOB_HEARTBEAT_SECONDS` | 60 | A worker silent for this long is treated as dead (minimum 10) |
| `SCRIPTORIUM_JOB_SUPERVISE_SECONDS` | 30 | How often the queue looks for dead jobs |

## How it works (for the curious)

The queue is **pg-boss**, which keeps its tables in a `pgboss` schema of the same PostgreSQL database, so there
is nothing extra to run or back up. Every job also has a `ProcessingJob` row (type, subject, state, progress,
attempts, error, result): the queue decides who works what; that row is what the app and you read. Job rows are
operational history and are not part of backups.

## How it is tested

`scripts/verify-jobs-api.mjs` (queueing, progress, no duplicates, no overlap, retry and failure) runs with the
other live checks. `scripts/verify-worker-recovery.mjs` starts a web server in external mode and a real worker
process, kills the worker with SIGKILL in the middle of a 40-page split, starts a new one, and checks that the job
is retried and finished. CI runs both.
