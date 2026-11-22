import pg from "pg";

// OCR, page splitting, indexing and backups each use a lot of CPU and memory. On a small server only one
// of them may run at a time, server-wide: the web server (backups) and the worker container (queued
// jobs) are separate processes, so the lock lives in PostgreSQL, not in memory.
//
// It is a session-level advisory lock held on a dedicated connection. If the process holding it dies,
// PostgreSQL closes the connection and the lock is released by itself; nothing can be left stuck. The
// connection's application_name says who holds it (visible in pg_stat_activity).
const HEAVY_LOCK_KEY = 7_274_837_201; // arbitrary, fixed: "the one heavy task" lock for this database

export const HEAVY_BUSY_MESSAGE = "Another long job (OCR, page split or backup) is running. Try again when it has finished.";

export type HeavyLock = { label: string; release: () => Promise<void> };

function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  // Prisma's "?schema=" parameter means nothing to the pg driver.
  return url.replace(/([?&])schema=[^&]*&?/, "$1").replace(/[?&]$/, "");
}

// Null when someone else holds the lock.
export async function tryAcquireHeavyLock(label: string): Promise<HeavyLock | null> {
  const client = new pg.Client({
    connectionString: connectionString(),
    application_name: `scriptorium-heavy-lock:${label}`.slice(0, 63),
    keepAlive: true
  });
  // An idle connection that drops must not crash the process (an 'error' with no listener would).
  client.on("error", (error) => console.error(`[heavy-lock] connection for ${label} failed:`, error));
  await client.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [HEAVY_LOCK_KEY]);
    if (!rows[0]?.locked) {
      await client.end();
      return null;
    }
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  let released = false;
  return {
    label,
    release: async () => {
      if (released) return;
      released = true;
      // Closing the session releases the lock even if the unlock itself fails.
      await client.query("SELECT pg_advisory_unlock($1)", [HEAVY_LOCK_KEY]).catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  };
}

// Waits (polling) until the lock is free. Used by queued jobs, which can afford to wait for a backup.
export async function acquireHeavyLock(
  label: string,
  { signal, pollMs = 5000, maxWaitMs = 30 * 60 * 1000 }: { signal?: AbortSignal; pollMs?: number; maxWaitMs?: number } = {}
): Promise<HeavyLock> {
  const until = Date.now() + maxWaitMs;
  for (;;) {
    signal?.throwIfAborted();
    const lock = await tryAcquireHeavyLock(label);
    if (lock) return lock;
    if (Date.now() >= until) throw new Error("Another long task (probably a backup) kept the server busy for too long; this job will be retried.");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, pollMs);
      function done() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      }
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}
