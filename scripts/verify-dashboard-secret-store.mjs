// Checks the dashboard's encrypted secret store: round trip, nothing readable on disk, wrong key and tampering refused.
//   node --experimental-strip-types scripts/verify-dashboard-secret-store.mjs
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deleteSecret, readSecret, writeSecret } from "../apps/dashboard/lib/secret-store.ts";

process.env.DASHBOARD_DATA_DIR = await mkdtemp(path.join(tmpdir(), "dash-secret-"));
process.env.DASHBOARD_AUTH_PASSWORD = "correct horse battery staple";
delete process.env.DASHBOARD_ENCRYPTION_KEY;

assert.equal(await readSecret("google"), null, "nothing stored yet");

const value = { refreshToken: "1//0gSUPER-SECRET-REFRESH-TOKEN", scopes: ["calendar.readonly"] };
await writeSecret("google", value);
assert.deepEqual(await readSecret("google"), value, "round trip");

const file = path.join(process.env.DASHBOARD_DATA_DIR, "google.json");
const onDisk = await readFile(file, "utf8");
assert.ok(!onDisk.includes("SUPER-SECRET") && !onDisk.includes("refreshToken"), "the token is not readable in the file");
assert.equal((await stat(file)).mode & 0o077, 0, "only the owner can read the file");

// Two saves of the same value look different (fresh salt and nonce each time).
await writeSecret("google", value);
assert.notEqual(await readFile(file, "utf8"), onDisk);

// A different key cannot read it (a changed dashboard password just means reconnecting once).
process.env.DASHBOARD_AUTH_PASSWORD = "a different password";
assert.equal(await readSecret("google"), null, "wrong key reads as 'not connected', never garbage or a crash");
process.env.DASHBOARD_ENCRYPTION_KEY = "explicit key";
await writeSecret("google", value);
process.env.DASHBOARD_AUTH_PASSWORD = "changed again"; // an explicit key outlives password changes
assert.deepEqual(await readSecret("google"), value, "DASHBOARD_ENCRYPTION_KEY takes precedence over the password");

// Tampering is detected.
const parsed = JSON.parse(await readFile(file, "utf8"));
parsed.data = Buffer.from("tampered").toString("base64");
await writeFile(file, JSON.stringify(parsed));
assert.equal(await readSecret("google"), null, "a modified file is refused");
await writeFile(file, "not json at all");
assert.equal(await readSecret("google"), null, "a corrupt file is refused");

await deleteSecret("google");
await deleteSecret("google"); // deleting twice is fine
assert.equal(await readSecret("google"), null);
console.log("Dashboard secret store verified: encrypted at rest, owner-only file, wrong key / tampering / corruption all read as 'not connected'.");
