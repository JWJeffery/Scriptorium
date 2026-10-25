import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

// Object storage for originals and derived files, over the S3 protocol (works with AWS S3,
// Cloudflare R2, Backblaze B2, SeaweedFS and others). Keys are the same relative storage keys the
// filesystem backend uses, so nothing in the database changes when the backend does.
//
//   SCRIPTORIUM_STORAGE_BACKEND=s3
//   SCRIPTORIUM_S3_BUCKET=scriptorium            (required)
//   SCRIPTORIUM_S3_ENDPOINT=http://localhost:8333 (omit for AWS S3 itself)
//   SCRIPTORIUM_S3_REGION=us-east-1               ("auto" for Cloudflare R2)
//   SCRIPTORIUM_S3_ACCESS_KEY_ID / SCRIPTORIUM_S3_SECRET_ACCESS_KEY
//   SCRIPTORIUM_S3_FORCE_PATH_STYLE=true          (default when an endpoint is set)
//   SCRIPTORIUM_S3_CREATE_BUCKET=true             (development only: create the bucket on first use)

export type S3Entry = { storageKey: string; size: number; modifiedAt: string };

type Config = { bucket: string; client: S3Client; createBucket: boolean };

let cached: Config | undefined;
let bucketReady: Promise<void> | undefined;

function config(): Config {
  if (cached) return cached;
  const bucket = process.env.SCRIPTORIUM_S3_BUCKET?.trim();
  if (!bucket) throw new Error("SCRIPTORIUM_S3_BUCKET must be set when SCRIPTORIUM_STORAGE_BACKEND=s3.");
  const endpoint = process.env.SCRIPTORIUM_S3_ENDPOINT?.trim() || undefined;
  const accessKeyId = process.env.SCRIPTORIUM_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.SCRIPTORIUM_S3_SECRET_ACCESS_KEY?.trim();
  const forcePathStyle = process.env.SCRIPTORIUM_S3_FORCE_PATH_STYLE ? process.env.SCRIPTORIUM_S3_FORCE_PATH_STYLE === "true" : Boolean(endpoint);
  const client = new S3Client({
    region: process.env.SCRIPTORIUM_S3_REGION?.trim() || "us-east-1",
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    // Newer SDK versions add checksum headers that some S3-compatible stores reject.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });
  cached = { bucket, client, createBucket: process.env.SCRIPTORIUM_S3_CREATE_BUCKET === "true" };
  return cached;
}

async function ensureBucket(settings: Config) {
  if (!settings.createBucket) return;
  bucketReady ??= (async () => {
    try {
      await settings.client.send(new HeadBucketCommand({ Bucket: settings.bucket }));
    } catch {
      await settings.client.send(new CreateBucketCommand({ Bucket: settings.bucket }));
    }
  })();
  await bucketReady;
}

function isMissing(error: unknown) {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

// Callers of the storage layer already recognise Node's ENOENT as "not found".
function enoent(key: string) {
  return Object.assign(new Error(`Stored file not found: ${key}`), { code: "ENOENT" });
}

export async function s3Put(key: string, bytes: Uint8Array, contentType?: string) {
  const settings = config();
  await ensureBucket(settings);
  await settings.client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: bytes, ...(contentType ? { ContentType: contentType } : {}) }));
}

export async function s3Get(key: string): Promise<Buffer> {
  const settings = config();
  await ensureBucket(settings);
  try {
    const response = await settings.client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
    return Buffer.from(await response.Body!.transformToByteArray());
  } catch (error) {
    if (isMissing(error)) throw enoent(key);
    throw error;
  }
}

export async function s3Size(key: string): Promise<number | null> {
  const settings = config();
  await ensureBucket(settings);
  try {
    const head = await settings.client.send(new HeadObjectCommand({ Bucket: settings.bucket, Key: key }));
    return head.ContentLength ?? 0;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function s3Delete(key: string) {
  const settings = config();
  await ensureBucket(settings);
  await settings.client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
}

export async function s3List(): Promise<S3Entry[]> {
  const settings = config();
  await ensureBucket(settings);
  const entries: S3Entry[] = [];
  let token: string | undefined;
  do {
    const page = await settings.client.send(new ListObjectsV2Command({ Bucket: settings.bucket, ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      if (object.Key) entries.push({ storageKey: object.Key, size: object.Size ?? 0, modifiedAt: (object.LastModified ?? new Date(0)).toISOString() });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return entries;
}
