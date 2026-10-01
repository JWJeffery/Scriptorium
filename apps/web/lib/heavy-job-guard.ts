// OCR and page splitting each use a lot of CPU and memory. On a small host,
// running several at once (or repeatedly triggering them) can exhaust it, so
// only one such job may run at a time. State lives on globalThis so it
// survives Next.js module reloads, like lib/prisma.ts.
const globalForGuard = globalThis as unknown as { scriptoriumHeavyJob?: { kind: string; id: string } | null };

export function tryAcquireHeavyJob(kind: string, id: string) {
  const current = globalForGuard.scriptoriumHeavyJob;
  if (current) return { acquired: false as const, running: current };
  globalForGuard.scriptoriumHeavyJob = { kind, id };
  return { acquired: true as const };
}

export function releaseHeavyJob(kind: string, id: string) {
  const current = globalForGuard.scriptoriumHeavyJob;
  if (current && current.kind === kind && current.id === id) globalForGuard.scriptoriumHeavyJob = null;
}
