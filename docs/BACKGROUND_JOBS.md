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
- **OCR saves its work every 10 pages.** If it is stopped (a deploy, a crash, the out-of-memory killer, its time
  limit), the next run starts at the first page not yet saved instead of page 1. Pages already read can be
  used straight away. When the whole book is done the result is exactly what one uninterrupted run gives.
- **OCR time limit grows with the book**: 5 minutes plus 20 seconds a page (a 425-page book: about 2 h 27 min;
  at most 10 hours). It is there so a stuck run cannot say "running" for ever. If it is reached, the job fails
  with "OCR timed out" and **Retry** continues from the saved pages.
- **Deploys do not lose work.** When the worker is told to stop it saves the pages done so far, stops at the next
  page and exits within 45 seconds (`docker-compose.prod.yml` gives it 60). On its next start the job continues
  by itself.
- **Nothing stays "running" for ever.** At start-up and every 5 minutes the worker checks every queued or
  running job against the queue. One with nothing behind it (the worker was killed twice, the job expired) is
  marked failed with a plain reason, so it can be retried and asking for the same work starts a new job.
- **One heavy task at a time, server-wide.** OCR, splits, indexing and backups share one lock in the database,
  so a backup (web server) never runs beside an OCR (worker). A backup asked for while a job runs is refused with
  "Another long job ... is running" (try again later); a queued job simply waits for a backup to finish.
- Page splitting kills a page that takes more than 2 minutes, and the whole split is limited to 5 minutes plus
  30 seconds a page.

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
| `SCRIPTORIUM_JOB_RECONCILE_SECONDS` | 300 | How often job records are checked against the queue (also at start-up) |
| `SCRIPTORIUM_OCR_BASE_SECONDS` | 300 | OCR time limit: fixed part |
| `SCRIPTORIUM_OCR_SECONDS_PER_PAGE` | 20 | OCR time limit: added for each page still to read |
| `SCRIPTORIUM_OCR_BATCH_PAGES` | 10 | OCR saves its results every this many pages |

A queue job may stay active for at most 12 hours (`expireInSeconds`); each job's own limit is shorter.

## How it works (for the curious)

The queue is **pg-boss**, which keeps its tables in a `pgboss` schema of the same PostgreSQL database, so there
is nothing extra to run or back up. Every job also has a `ProcessingJob` row (type, subject, state, progress,
attempts, error, result): the queue decides who works what; that row is what the app and you read. Job rows are
operational history and are not part of backups.

## How it is tested

`scripts/verify-jobs-api.mjs` (queueing, progress, no duplicates, no overlap, retry and failure) runs with the
other live checks. `scripts/verify-worker-recovery.mjs` starts a web server in external mode and a real worker
process, kills the worker with SIGKILL in the middle of a 40-page split, starts a new one, and checks that the job
is retried and finished. CI runs both. `scripts/verify-ocr-resume.mjs` (run at the end of
`scripts/run-live-suite.sh`) OCRs a small scanned book with real workers: it stops one with SIGTERM mid-book and
checks the next continues from the first unsaved page, lets the time limit stop another and checks Retry
continues, compares the final text spans with one uninterrupted run, checks stuck job records are marked failed
and can be retried, and checks backups and jobs share the one lock.
