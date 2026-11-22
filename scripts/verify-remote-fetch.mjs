// Unit check of link import rules (apps/web/lib/remote-fetch.ts): share links become download links, and private
// network addresses are refused.
//   node --experimental-strip-types scripts/verify-remote-fetch.mjs
import assert from "node:assert/strict";
import { fetchRemotePdf, isPublicAddress, RemoteFetchError, toDownloadUrl } from "../apps/web/lib/remote-fetch.ts";

const drive = toDownloadUrl("https://drive.google.com/file/d/1AbC_d-9/view?usp=sharing");
assert.equal(drive.provider, "google-drive");
assert.equal(drive.url.toString(), "https://drive.usercontent.google.com/download?id=1AbC_d-9&export=download&confirm=t");
assert.equal(toDownloadUrl("https://drive.google.com/open?id=XYZ").url.searchParams.get("id"), "XYZ");
assert.throws(() => toDownloadUrl("https://docs.google.com/document/d/1/edit"), /not a PDF/);
assert.throws(() => toDownloadUrl("https://drive.google.com/drive/folders/abc"), /single file/);
assert.equal(toDownloadUrl("https://www.dropbox.com/scl/fi/x/book.pdf?rlkey=k&dl=0").url.searchParams.get("dl"), "1");
assert.equal(toDownloadUrl("https://app.box.com/s/abc123").url.toString(), "https://app.box.com/shared/static/abc123");
assert.equal(toDownloadUrl("https://example.org/a/book.pdf").provider, "web");
assert.throws(() => toDownloadUrl("file:///etc/passwd"), /http and https/);
assert.throws(() => toDownloadUrl("not a link"), /not a web address/);

for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) assert.equal(isPublicAddress(ip), false, `${ip} is private`);
for (const ip of ["8.8.8.8", "142.250.72.14", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(ip), true, `${ip} is public`);

delete process.env.SCRIPTORIUM_IMPORT_ALLOW_PRIVATE;
for (const target of ["http://127.0.0.1/book.pdf", "http://169.254.169.254/latest/meta-data/", "http://[::1]/x.pdf", "http://localhost/x.pdf"]) {
  await assert.rejects(fetchRemotePdf(target, 1_000_000), (error) => error instanceof RemoteFetchError && /private network/.test(error.message), `refuses ${target}`);
}
console.log("Link import rules verified: Drive, Dropbox and Box share links, unsupported links, private addresses refused.");
