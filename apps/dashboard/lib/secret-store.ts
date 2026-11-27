import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Keeps small secrets (the Google sign-in) on disk, encrypted. The file is useless without the key:
// DASHBOARD_ENCRYPTION_KEY if set, otherwise the dashboard password. (Changing the password then means
// reconnecting Google once; nothing else is lost.)

const dir = () => process.env.DASHBOARD_DATA_DIR || path.join(process.cwd(), ".data");

function secret() {
  const value = process.env.DASHBOARD_ENCRYPTION_KEY || process.env.DASHBOARD_AUTH_PASSWORD;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("No encryption key: set DASHBOARD_AUTH_PASSWORD or DASHBOARD_ENCRYPTION_KEY.");
  return "development-only-key";
}

export async function writeSecret(name: string, value: unknown) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(secret(), salt, 32), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const file = path.join(dir(), `${name}.json`);
  await mkdir(dir(), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ v: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }), { mode: 0o600 });
  await rename(temp, file); // all-or-nothing: a crash never leaves a half-written file
}

/** The stored value, or null when nothing is stored or it cannot be decrypted (wrong key). */
export async function readSecret<T>(name: string): Promise<T | null> {
  let text: string;
  try { text = await readFile(path.join(dir(), `${name}.json`), "utf8"); } catch { return null; }
  try {
    const file = JSON.parse(text) as { salt: string; iv: string; tag: string; data: string };
    const decipher = createDecipheriv("aes-256-gcm", scryptSync(secret(), Buffer.from(file.salt, "base64"), 32), Buffer.from(file.iv, "base64"));
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function deleteSecret(name: string) {
  await rm(path.join(dir(), `${name}.json`), { force: true });
}
