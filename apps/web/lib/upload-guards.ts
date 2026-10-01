// Upload checks that do not trust the browser-supplied file.type or filename.

export const MAX_DOCX_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_UPLOAD_BYTES = 10 * 1024 * 1024;

// PDF readers accept the "%PDF-" header anywhere in the first 1024 bytes.
export function looksLikePdf(bytes: Uint8Array) {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

// DOCX is a ZIP container: "PK\x03\x04" (a non-empty archive).
export function looksLikeZip(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export async function validateDocx(file: File): Promise<string | null> {
  if (file.size > MAX_DOCX_BYTES) return "DOCX exceeds the upload size limit.";
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return looksLikeZip(head) ? null : "The uploaded file is not a valid DOCX document.";
}
