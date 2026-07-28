// pdfjs-dist's Node.js detection (isNodeJS, checked in its own PDFWorker
// static initializer) always routes through _setupFakeWorker(), which
// checks globalThis.pdfjsWorker?.WorkerMessageHandler FIRST before ever
// attempting `await import(workerSrc)`. That dynamic import is what fails
// under webpack bundling - the default workerSrc ("./pdf.worker.mjs")
// resolves relative to wherever webpack physically places pdf.mjs's
// *bundled output*, not pdf.worker.mjs's real location, and there's no
// reliable way to override workerSrc itself (webpack statically intercepts
// require.resolve() even through createRequire, and externalizing the
// whole pdfjs-dist package breaks the client-side reader, which needs it
// bundled normally for its own new URL(..., import.meta.url) worker setup).
//
// Skipping the import entirely, by pre-populating the global pdfjs itself
// checks, sidesteps all of that. This is pdfjs-dist's own intended
// Node.js integration path, not a workaround bolted on top of it.
//
// Import this module for its side effect before calling getDocument
// anywhere on the server. Never import it from client-side code.
// pdfjs-dist ships pdf.worker.mjs as a plain build artifact with no .d.ts -
// there's nothing to type here beyond "some module object", which is all
// globalThis.pdfjsWorker needs to be.
// @ts-expect-error - no type declarations for this build artifact
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

(globalThis as unknown as { pdfjsWorker?: typeof pdfjsWorker }).pdfjsWorker = pdfjsWorker;
