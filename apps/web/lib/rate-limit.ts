// A small in-memory rate limiter (sliding window), shared by the middleware and
// the login route. It lives in one server process, which is what a single personal
// Scriptorium is; it is a brake on runaway scripts and password guessing, not a
// defence against a distributed attack.

type Bucket = { hits: number[] };

const globalForLimiter = globalThis as unknown as { scriptoriumRateBuckets?: Map<string, Bucket> };
const buckets = globalForLimiter.scriptoriumRateBuckets ?? new Map<string, Bucket>();
globalForLimiter.scriptoriumRateBuckets = buckets;

export type RateDecision = { allowed: boolean; retryAfterSeconds: number; remaining: number };

/** Count one hit against `key`; allow at most `limit` hits per `windowSeconds`. */
export function hit(key: string, limit: number, windowSeconds: number, now = Date.now()): RateDecision {
  const windowMs = windowSeconds * 1000;
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((time) => now - time < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000)), remaining: 0 };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 5000) prune(now, windowMs);
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - bucket.hits.length };
}

/** Whether `key` is already over the limit, without counting a new hit. */
export function blocked(key: string, limit: number, windowSeconds: number, now = Date.now()): RateDecision {
  const windowMs = windowSeconds * 1000;
  const live = (buckets.get(key)?.hits ?? []).filter((time) => now - time < windowMs);
  if (live.length >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((live[0] + windowMs - now) / 1000)), remaining: 0 };
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - live.length };
}

export function reset(key: string) {
  buckets.delete(key);
}

function prune(now: number, windowMs: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.hits.every((time) => now - time >= windowMs)) buckets.delete(key);
  }
}

/** The visitor's address as the proxy in front of the app reports it. */
export function clientKey(headers: { get(name: string): string | null }) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
