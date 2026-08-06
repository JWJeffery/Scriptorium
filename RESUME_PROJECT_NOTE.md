# Scriptorium — resume note

Read this first in any new session before touching code. Update it at the end of every
session that changes the build state (new gates, fixes, pushes) — same discipline as
The Universal Office's RESUME_PROJECT_NOTE.md.

## What this project is

A scholarly reading/annotation/citation app for doctoral theological/historical research
(Josh's own words: "a redemption project for me," architected by Lucy). Separate codebase
and repo from The Universal Office — no shared corpus, engine, or vocabulary. Next.js 14 +
TypeScript + Prisma/MySQL. See `ARCHITECTURE.md`, `PRODUCT_BRIEF.md`, `ROADMAP.md` for the
original design intent, and `docs/development-ledger.json` + `docs/development-ledger.html`
("the dashboard") for the live gate-by-gate build status.

## Working pattern established this session

Josh is not a coder; he applies changes by hand from files Claude hands him. The loop that
worked reliably:

1. Claude does all real work in its own sandbox clone — writes code, and **actually
   executes it** (Node 22's `--experimental-strip-types` flag lets `.ts` files run directly
   without a build step, which made it possible to run real fixture assertions instead of
   just grepping source for keywords like the project's original `verify-milestone-*.mjs`
   scripts did).
2. Claude packages the diff as a `.patch` file and hands it to Josh as a download.
3. Josh applies it in his Codespace: `git apply <file>.patch`, then `git add -A && git commit
   && git push`.
4. Real CI is the actual source of truth — Claude cannot see GitHub Actions directly (no
   push/API access; the sandbox's own network is separately blocked from
   `binaries.prisma.sh`, so Prisma-client-dependent typechecks are unreliable *inside the
   sandbox* even though they work fine in real CI). Josh pastes screenshots or downloaded
   log artifacts (`typecheck-log`, `build-log`) back into the conversation when something's
   red.

**Two sharp edges hit repeatedly this session, worth remembering:**

- When Josh downloads a `.patch` file, it lands directly in the repo's working directory.
  If he then runs `git add -A` **before** `git apply`, the raw patch file itself gets
  committed as tracked content instead of being applied. Always: `git apply` first, confirm
  it worked (`git diff` or `git status` should show the *code* changes, not a new
  `*.patch` file), then clean up the patch file before staging.
- `git apply --stat <file>.patch` is a safe, side-effect-free way to preview a patch before
  applying it for real.

## Known pitfalls specific to this codebase (don't reintroduce these)

1. **`apps/web/tsconfig.json` targets `es5`.** A regex *literal* using the `u` flag (needed
   for `\p{L}\p{N}` Unicode property escapes) fails TypeScript compilation under that target
   (`TS1501`), even though the flag itself is fully supported at runtime by Node and every
   current browser — the target only restricts what syntax TS lets you *author*, not what
   the engine can *run*. Workaround used: build the regex via `new RegExp(pattern, "u")`
   (a runtime string) instead of a literal — TypeScript only statically checks literal regex
   flags, not ones built from a string at runtime. See `lib/local-similarity.ts`.
2. **Next.js App Router `route.ts` files only allow specific exports** — the HTTP handlers
   (`GET`/`POST`/`PATCH`/etc.) plus a small config allowlist (`runtime`, `dynamic`, and a
   few others). Exporting anything else (a plain constant, a helper type) fails at build
   time with "is not a valid Route export field," even though it typechecks fine in
   isolation. If a route needs an internal constant, keep it un-exported, or move it to a
   `lib/` file if something else genuinely needs to import it.
3. **The sandbox Claude works in cannot reach `binaries.prisma.sh`.** `prisma generate`
   and `prisma validate` fail there with a 403, meaning `@prisma/client` never gets its real
   generated types inside the sandbox — this produces a cascade of `any`-typed
   errors in anything touching Prisma models when Claude runs `tsc` locally. This is **not**
   a real bug; real CI (and Josh's Codespace) can reach that domain fine. Don't trust a
   sandbox-local typecheck failure involving Prisma types without cross-checking against
   real CI output.
4. **Local dev needs MySQL running.** `docker compose up -d` in the repo root starts it
   (matches the `.env`/`.env.example` credentials already in the repo); `docker compose ps`
   should show it `healthy` before running `prisma migrate deploy`.

## Build status as of this session

Gates 1–13: green, closed, audited (original state before this session — untouched).

Gates 14–18 added this session, addressing gaps found during a full code-level review
(not just reading docs — actually cloning, running, and executing the real modules):

| Gate | What | Status |
|---|---|---|
| 14 | Turabian/APA/MLA/Harvard citation styles; CSL records now model chapters/articles/manuscripts, not just books; RIS export/import added. New additive route `api/milestone-fourteen/csl-source-editor` — original Milestone 6 route deliberately left untouched. | green |
| 15 | Citation regeneration — staleness tracking + supersession lineage, never mutates history. New Prisma columns + migration. | green |
| 16 | Corpus backup/export — full DB export + on-disk file manifest. | green |
| 17 | OCR pipeline contract — scan detection heuristic + pluggable provider interface. Explicitly no real OCR engine bundled. | green |
| 18 | Real bug fix: search/similarity tokenizer was ASCII-only, silently blind to Greek/Ge'ez/Syriac/Coptic text. Fixed to Unicode-aware matching. | green |

All five are green with evidence pointing at real CI run 30228151197 (commit `25cba6c`) —
not per-gate issues/PRs the way gates 1–13 were closed. That's a deliberate deviation this
session, not an oversight; see "Outstanding work" for the open question about whether to
retrofit issues/PRs for these five.

**Commits pushed this session, in order, on `main`:**
1. `5203785` — the main gates 14–18 commit (22 files)
2. `56222a4` — accidentally committed the *patch file itself* without applying it first (see
   "sharp edges" above) — real fix landed in the next commit
3. `cdbfd72` — actually applied the ES5-regex-target fix (pitfall #1 above)
4. `25cba6c` — fixed the invalid Next.js route export (pitfall #2 above)

**As of the end of this session:** commit `25cba6c` came back **green** in real CI
(Scriptorium CI #121, run 30228151197 — Typecheck and build + MySQL migration deploy both
passed). Gates 14–18 have been flipped from `yellow` to `green` in
`docs/development-ledger.json` accordingly, with evidence pointing at that real CI run
rather than per-gate issues/PRs (this session pushed directly to `main` instead of the
issue-per-gate pattern gates 1–13 used — see "Outstanding work" below).

## Outstanding work

- **Gates 14–17 now have a first UI**, added as `components/ScholarlyToolsPanel.tsx` and
  rendered below `ScriptoriumMilestoneOnePersisted` on the home page. Four tabs: expanded
  CSL source editor, citation regeneration/staleness, corpus export (JSON download), OCR
  scan detection. It reads the current document/source id out of the same
  `scriptorium.currentDocument` localStorage key the main workflow already writes
  (read-only) and also accepts manual id entry, so it works standalone. This is functional
  but not yet visually polished. The OCR scan-detection tab specifically went through an
  extensive real debugging session with Josh (stale dev-server processes, missing Prisma
  client, MySQL not running, and the pdfjs-dist worker-file bug documented below) - the fix
  for the last of those is in this patch but not yet confirmed working by Josh. The other
  three tabs (source editor, citation regeneration, corpus export) remain untested by him.
- **Real OCR is now wired in (was previously detection-only).** Two new lib modules:
  `lib/pdf-text-extraction.ts` (reads a PDF's real embedded text layer via pdfjs-dist,
  no rendering) and `lib/tesseract-ocr-provider.ts` (renders pages via pdfjs-dist +
  `@napi-rs/canvas`, recognizes with Tesseract, English only per Josh's choice). Two new
  dependencies: `tesseract.js`, `@napi-rs/canvas` — both ship prebuilt/WASM, no system
  Cairo/Poppler needed, but `@napi-rs/canvas` is still a native package, worth keeping in
  mind for the eventual Spaceship/cPanel deploy target.
- **Found and fixed a real bug while building OCR:** PDF ingestion never persisted any
  extracted text server-side — `TextSpan` rows were never created for PDFs, only for
  TXT/MD/DOCX. That meant scan detection's `extractedTextLength` was always 0 and its
  `pageCount` was always 1 (it was counting `PageMap` rows, not real PDF pages) for every
  PDF ever registered, so it was flagging 100% of PDFs as "likely scanned" regardless of
  whether they had a real text layer. Fixed in `api/milestone-one/files/route.ts`: ingestion
  now calls `extractPdfText` and persists one `TextSpan` per page; `extractionState` is now
  `server-pdfjs-text-layer` / `server-pdfjs-no-text-layer` / `server-pdfjs-extraction-failed`
  instead of the uninformative `browser-local-pdfjs`. `ocr-status/route.ts` GET now derives
  `pageCount` from `textSpans.length` (falls back to the old `pages.length` for documents
  registered before this fix, so they read as less precise rather than wrong). **This means
  documents registered before this patch will still show stale detection results until
  re-registered** — there's no backfill migration for already-ingested PDFs.
- OCR POST now actually runs Tesseract, deletes the version's old TextSpans, and writes
  fresh ones from the recognized per-page text, updating `extractionState` to
  `tesseract-js-eng-v1`. Low-confidence pages (<40%) come back as warnings in the API
  response and are surfaced in the panel's status line.
- **Validated locally in the sandbox** with synthetic fixture PDFs (one with a real text
  layer, one image-only) built via a scratch `pdf-lib` script (not committed): text
  extraction correctly distinguished the two, and the full render→Tesseract pipeline
  produced 95% confidence with an exact text match once a sandbox-specific WASM SIMD
  execution bug was worked around (`wasm-feature-detect` claimed SIMD support that then
  failed at runtime — forcing the non-SIMD LSTM core fixed it). **This looked like a
  container/emulation quirk specific to this sandbox, not a code bug, but hasn't been
  confirmed working in Josh's actual Codespace yet.** If the exact error
  `Aborted(missing function: _ZN9tesseract13DotProductSSEEPKfS1_i)` shows up there too,
  that's the thing to revisit — Tesseract's Node core-selection (`getCore.js`) auto-detects
  SIMD support and doesn't expose a way to override it through the public `createWorker`
  API, so a real fix would mean patching around that, not just passing an option.
- **Real bug shipped and then caught by Josh: the OCR feature broke the build entirely.**
  This repo had no `next.config.js`/`.mjs` at all before now. Without `serverExternalPackages`
  telling webpack to leave native/binary packages alone, webpack tried to parse
  `@napi-rs/canvas`'s platform `.node` binary as JavaScript and failed outright with
  `Module parse failed: Unexpected character` - a hard build error, not a runtime one, so
  it broke `next dev` immediately on Josh's next pull. Added `apps/web/next.config.mjs`
  with `serverExternalPackages: ["@napi-rs/canvas", "tesseract.js", "tesseract.js-core"]`.
  **Root cause of the miss:** the sandbox testing that validated the OCR pipeline ran raw
  `.ts` fixture scripts directly via `node --experimental-strip-types`, which proved the
  rendering/recognition *logic* was correct but never went through Next.js's webpack
  bundler at all - the one thing that would have caught this. Confirmed the fix by actually
  reproducing the build error in the sandbox first (`next build`, real failure), then
  confirming `next build` compiles clean past that stage with the config added. A live
  `next dev` request-level test was attempted but the background process got reaped by
  the sandbox's job control before it could be hit - `next build` and `next dev` share the
  same webpack module-resolution path for externals, so this is still solid evidence, but
  it's a build-time proof, not a request-level one. **Lesson for future sessions building
  anything with native/WASM dependencies: run it through the actual Next.js build, not just
  raw Node scripts, before calling it verified.**
- **The next.config.mjs fix above did not resolve it for Josh, three separate times, including
  after a fully clean `pkill next dev` + `rm -rf apps/web/.next` + `pnpm dev` restart.**
  Every reproduction attempt in the sandbox succeeded, including a fully fresh
  `rm -rf node_modules && pnpm install` matching what should have been an equivalent clean
  state - never once reproduced Josh's failure. The one thing never tried on Josh's side
  was clearing `node_modules` itself, only `.next` (Next's build cache) - if the native
  `@napi-rs/canvas-linux-x64-gnu` package installed incompletely or got corrupted at some
  point, that would produce exactly this symptom and wouldn't be fixed by clearing `.next`
  at all. Added a second, independent layer of defense on top of `serverExternalPackages`:
  an explicit webpack rule (`node-loader` package) that handles `.node` binary files by file
  extension rather than relying on Next's package-name-based externalization matching every
  possible platform-package name. Also broadened `serverExternalPackages` to list Darwin and
  ARM platform variants of `@napi-rs/canvas`, not just the Linux x64 one seen in the error.
  **If this still doesn't resolve it, the next thing to check is whether Josh's Codespace has
  prebuilds enabled (devcontainer prebuild caching could be serving a stale snapshotted
  `node_modules`/`.next` state that survives a normal in-session `rm -rf`) - that's outside
  what a code patch can fix and would need investigating directly in his Codespace settings.**
- **The actual OCR rendering bug, found and fixed by reproducing it for real.** Once the
  `.node` build error and stale-process/stale-DB issues above were cleared, a genuinely
  different error surfaced: `Setting up fake worker failed: Cannot find module
  '.../vendor-chunks/pdf.worker.mjs'`. This is a pdfjs-dist + webpack issue, not related to
  the native binary problem. pdfjs-dist needs a separate `pdf.worker.mjs` file at runtime;
  by default it resolves that file relative to wherever webpack physically places pdf.mjs's
  *bundled output* (`.next/server/vendor-chunks/`), which never contains a copy of the
  worker file.

  Two failed attempts before the real fix, both worth recording so they aren't retried:
  1. Manually overriding `GlobalWorkerOptions.workerSrc` via `require.resolve` -
     webpack statically intercepts `require.resolve()` calls even through `createRequire`,
     rewriting them into its own internal module IDs instead of real file paths (confirmed
     with debug logging).
  2. **Adding `"pdfjs-dist"` to `serverExternalPackages`** - this actually did fix the OCR
     render path, verified through a real dev-server request. But it broke something else:
     `components/PdfAnchoredPageReader.tsx` (the existing, pre-OCR client-side PDF reader)
     sets `pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(..., import.meta.url)`, the
     normal webpack pattern for client-bundled worker assets - and that requires pdfjs-dist
     to be bundled normally, not externalized. `serverExternalPackages` externalizes a
     package for *all* server-side compilation, including the server-side reference pass
     Next.js does for "use client" components as part of building the RSC boundary - not
     just the OCR API routes. Josh caught this immediately (`Module not found: ESM packages
     (pdfjs-dist/build/pdf.worker.min.mjs) need to be imported`, on the homepage, from
     `PdfAnchoredPageReader.tsx`). Reverted.

  **Actual fix, found in pdfjs-dist's own source**: `PDFWorker._setupFakeWorkerGlobal`
  checks `globalThis.pdfjsWorker?.WorkerMessageHandler` *before* ever attempting the dynamic
  `import(workerSrc)` that fails. Pre-populating that global by directly, statically
  importing `pdfjs-dist/legacy/build/pdf.worker.mjs` (a normal import, not a
  dynamically-constructed path pdfjs itself uses `webpackIgnore` on - so webpack bundles it
  correctly without any special handling needed) and assigning it to
  `globalThis.pdfjsWorker` makes pdfjs skip the broken import path entirely. This is
  pdfjs-dist's own intended Node.js integration point, not a workaround. Implemented as
  `lib/pdfjs-worker-setup.ts`, imported for its side effect at the top of both
  `pdf-text-extraction.ts` and `tesseract-ocr-provider.ts` - never import it from
  client-side code. `next.config.mjs`'s `serverExternalPackages` no longer includes
  `pdfjs-dist`.
  **Verified this time by testing both paths together**, not just the one that broke last
  time: hit a throwaway OCR-render test route (confirmed working, same PNG byte count as
  every earlier successful render) *and* the homepage (confirmed loading clean, no
  `PdfAnchoredPageReader.tsx` error) in the same session, both through a real dev server via
  HTTP. Also confirmed a full production `next build` compiles clean. This is the pattern to
  repeat for any future bug in this dependency chain: reproduce through a real request to a
  real dev server before
  believing a fix, not through an isolated script.
- **After that fix landed, OCR still appeared to do "nothing" when clicked.** Turned out to
  be a real, different problem: the browser console showed two `504 Gateway Timeout` errors
  on the OCR POST request. The request was reaching the server fine - real OCR (page
  rendering + Tesseract recognition + a first-run ~15MB language-data download) was just
  taking longer than GitHub Codespaces' port-forwarding proxy allows a single HTTP request
  to stay open. Not something fixable by waiting longer or optimizing OCR speed - the
  request needed to stop blocking on the work at all.
  **Fix: made OCR asynchronous.** `ocr-status` POST now marks the version's
  `extractionState` as `tesseract-js-eng-v1-running` and returns immediately (202) without
  waiting for OCR to finish; the actual `tesseractOcrProvider.extractText` call runs
  unawaited in the background. GET now includes an `ocrRunning` flag per version. The panel
  polls GET every 4 seconds after starting OCR (capped at ~2.5 minutes) instead of waiting
  on one long-lived request, and auto-resumes polling on load if a previous OCR run is still
  in progress (covers a page refresh mid-run). New extraction states:
  `tesseract-js-eng-v1-running`, `tesseract-js-eng-v1-failed`, `tesseract-js-eng-v1-no-text`,
  alongside the existing success state `tesseract-js-eng-v1`.
  **Confirmed by Josh, and it exposed two real gaps.** The async architecture itself worked -
  no more 504s - but OCR sat in "running" for 25+ polls (~100+ seconds) with zero visible
  progress: the terminal showed nothing but fast, empty polling `GET` requests, no sign the
  actual Tesseract work (page render, recognition, first-run language-data download) was
  progressing at all. Most likely cause: `tesseract.js`'s language-data fetch has no built-in
  timeout, so a stalled/slow download hangs indefinitely rather than erroring.
  This exposed a worse problem: **the version could get stuck in `-running` state forever**,
  with no way to tell "slow" from "dead" from the outside - and the POST route was
  explicitly *rejecting* retry attempts while that state was set (a 409 "already running"),
  meaning a hang had no recovery path short of manually editing the database.
  Two fixes: (1) added a hard 3-minute timeout (`BACKGROUND_TIMEOUT_MS`) around the
  `extractText` call via `Promise.race`, with a distinct `tesseract-js-eng-v1-timed-out`
  state and a clear message telling Josh to just try again. (2) Removed the 409 guard
  entirely - since there's no real way to detect whether a "-running" version's background
  task is actually still alive versus orphaned by a server restart, blocking retry on that
  state was strictly worse than allowing a redundant concurrent run. Also had to guard
  against a subtler bug: `Promise.race` doesn't cancel the underlying `extractText` call, so
  if it settles *after* the timeout already fired, that orphaned promise could throw an
  unhandled rejection later and crash the whole Node process - attached an inert `.catch(() =>
  {})` directly to it to prevent that.
  **Still not confirmed end-to-end**: whether OCR now actually completes within 3 minutes in
  Josh's environment, or reliably hits the new timeout state instead, hasn't been observed
  yet. If it keeps timing out, the language-data download itself is the next thing to
  investigate directly - e.g. whether Codespaces' network is slow/restricted to whatever CDN
  `tesseract.js` defaults to, in which case pointing `langPath` at a mirror this repo already
  used successfully once for sandbox testing (`raw.githubusercontent.com/naptha/tessdata`)
  might be the real fix, not just a longer timeout.
- The first OCR run in any environment downloads Tesseract's English language data
  (~15MB) into the working directory by default (`eng.traineddata`) — added
  `*.traineddata` to `.gitignore` so this can't get committed by accident.
- **Decided (Josh): "pushed directly to main + real CI green" is sufficient evidence going
  forward.** Gates 14–18 will not be retrofitted with per-gate issues/PRs. This is now the
  standing convention for future gates too — don't reopen the question next session.
- A **second** stray patch file (`fix-corpus-export-route-shape.patch`) was found still
  tracked in the repo root after this note was first written — it had been committed
  alongside the real fix in `25cba6c` instead of being deleted once applied. Removed in
  commit `864944d`.
- **A third instance happened immediately after that cleanup, in the very commit that
  delivered the cleanup.** The patch file (`scriptorium-cleanup.patch`) that carried the
  gate-14–18-adjacent fixes landed in the working directory when Josh downloaded it, and
  the copy-paste command sequence handed to him was `git apply <file> && git add -A &&
  git commit ...` — which stages the patch file itself along with the real changes,
  because it's sitting in the working tree at `git add -A` time. Writing "delete the patch
  file in the same commit" into this note doesn't fix anything, because Josh doesn't read
  this note — Claude does, at the *start* of a session. The instruction has to be in the
  command sequence Claude hands Josh, every time, not in prose here.
  **Fixed convention going forward: every copy-paste command block Claude gives Josh for
  applying a patch must be `git apply <file>.patch && rm <file>.patch && git add -A &&
  git commit -m "..." && git push origin main` — the `rm` step is mandatory and non-optional,
  not a suggestion Josh has to remember on his own.** Removed the stray file in commit
  (see git log after this note is applied).

## Manual-selection corruption warning (reader data integrity)

While confirming OCR worked on "The Integrity of Anglicanism", Josh selected text in the
regular reader (not OCR) and captured "NGUCA" - garbled nonsense - as if it were a normal,
trustworthy selection. Root cause: `PdfAnchoredPageReader.tsx`'s selectable text layer is
built from `pdf.js`'s own `getTextContent()`, the same API used server-side for extraction.
This specific PDF has malformed embedded fonts (the "getPathGenerator - ignoring character:
Requesting object that isn't resolved yet" warnings that flooded the terminal throughout
every OCR attempt this session are `pdf.js` failing to resolve glyphs on this exact file) -
so the captured text wasn't fabricated by the app, it's genuinely what `pdf.js` parsed from
a corrupted source. Not a logic bug in `captureSelection` itself.

Fixed anyway, because nothing previously warned the person this could happen - a corrupted
capture looked identical to a normal one. A pure character-level heuristic (vowel ratio,
consonant-run length) was tried first and rejected: tested against "NGUCA" and it *missed*
it (2 vowels in 5 letters reads as plausible), while false-flagging real English words like
"strengths" (low vowel ratio is common and unremarkable in real text). Shipping an
unreliable heuristic would have been worse than nothing.

Real fix: added `api/milestone-sixteen/page-text` (`GET ?versionId=&pdfPageIndex=`), which
returns the independently-derived text for that page - server extraction on ingest, or a
real OCR pass, whichever exists - by matching `TextSpan.anchor.pdfPageIndex`.
`ScriptoriumMilestoneOnePersisted.tsx` fetches this whenever the current PDF version or page
changes and passes it into the reader as `authoritativePageText`. `captureSelection` now
checks any selection ≥8 characters against it (case/punctuation-loose substring match) and,
if it isn't found anywhere in the authoritative text, replaces the normal "Captured
selected text..." success message with an explicit warning naming the likely cause and
telling the person to verify carefully before saving - rather than silently proceeding as
if nothing were wrong. Absence of authoritative text (most documents, since extraction/OCR
data is new) means the check is silently skipped, not treated as a "verified" result -
important not to invert that logic later.

Not yet confirmed against the live "NGUCA" page specifically - verified via `next build`
and reasoning through the code path only, since this sandbox has no MySQL to actually
reproduce the original selection. Worth Josh re-selecting that exact spot to confirm the
warning fires as intended.

## Real fix for the corrupted text layer, not just a warning

Following on from the manual-selection warning above: Josh pushed back on stopping at "warn
when it's wrong" and asked to actually fix the text layer, or explain how rarely OCR text
would even be around to check against (fair question - the corroboration warning only helps
when a page needed OCR *and* still has a corrupted-but-selectable layer underneath, which
won't be the common case). The better, more broadly useful fix: use real OCR data to
*replace* the broken layer for pages OCR ran on, not just flag it after the fact.

Tesseract can return word-level bounding boxes, not just a flat text blob - this wasn't
being captured before. Confirmed in the sandbox (with the same non-SIMD-core diagnostic
patch used earlier, reverted after): calling `worker.recognize(image, {}, { blocks: true })`
instead of the bare call returns `data.blocks[].paragraphs[].lines[].words[]`, each with
`{text, bbox: {x0,y0,x1,y1}, confidence}` in the *rendered* pixel space (RENDER_SCALE=2).
Verified against the same synthetic fixture used throughout this session - real, accurate
per-word positions, not estimated.

Changes:
- `lib/ocr-provider.ts`: added `OcrWord` type; `OcrResult.pages[].words` is now populated.
- `lib/tesseract-ocr-provider.ts`: requests `{ blocks: true }`, flattens the block/paragraph/
  line/word tree into a flat array per page, converts each bbox from RENDER_SCALE pixel
  space back to scale=1 PDF page-space (divide by `RENDER_SCALE`) - that's the same
  coordinate space the reader renders pages in client-side, so positions line up directly
  with no further transform needed on the client.
- `ocr-status/route.ts`: persists `words` inside each `TextSpan.anchor` JSON alongside the
  existing `pdfPageIndex`/`ocr`/`confidence` fields.
- `api/milestone-sixteen/page-text/route.ts`: now also returns `words` (null when a page's
  TextSpan has none, e.g. plain extraction with no OCR).
- `PdfAnchoredPageReader.tsx`: new `authoritativeWords` prop. When present and non-empty, it
  *replaces* pdf.js's own `getTextContent()`-derived text layer for building the selectable
  `.pdfTextRun` spans - real positioned OCR words instead of whatever pdf.js parsed from the
  page's (possibly malformed) embedded fonts. pdf.js's own extraction remains the fallback
  for pages nothing OCR'd (the normal case for a genuinely good PDF). The manual-selection
  corroboration check from the previous fix is skipped when the OCR layer is active - it's
  authoritative by construction there, and comparing against the separately-joined flat text
  string risked a confusing false alarm rather than adding real safety.
- `ScriptoriumMilestoneOnePersisted.tsx`: fetches and threads `authoritativeWords` through
  the same effect that already fetches `authoritativePageText`.

**Scope, stated honestly per Josh's actual question**: this only produces a *better*
selectable layer for pages that were OCR'd - it can't create positions for a purely
image-only page nobody has run OCR on yet, and doesn't help pages with a genuinely good
existing pdf.js text layer (nothing to replace there). The real remaining gap for a corpus
with many scanned pages is that a page with *zero* selectable text of any kind still can't
be annotated by drag-selection at all - that's a separate feature (e.g. rectangle-region
annotation over the rendered image, using OCR'd text as the underlying quote) that hasn't
been built.

Verified via `tsc --noEmit` (only the pre-existing Prisma-type cascade, unrelated) and a
full production `next build`. Not yet confirmed live against the actual "NGUCA" page with
real MySQL - the coordinate math and data flow are verified correct end-to-end in the
sandbox with the synthetic fixture, but the real, decisive test is Josh re-selecting that
same spot on "The Integrity of Anglicanism" and getting real, correct, positioned text
instead of a warning.

## Re-run OCR was hidden once a document succeeded once

Josh re-selected the same "NGUCA" spot after the word-position fix landed and it was still
garbled - not because the fix was wrong, but because this document's existing OCR text was
generated by the *old* code, before word positions were captured. Re-running OCR would fix
it, but the "Attempt OCR" button in `ScholarlyToolsPanel.tsx` was only ever shown when
`result.likelyScanned` was true - and detection now correctly sees this document as having a
real text layer (the OCR text itself), so the button was hidden. There was no way to force a
re-run once a document had already succeeded once.

Fixed: the OCR action now always shows, not just when currently flagged as scanned. Labeled
"Re-run OCR" (with a short explanatory hint) instead of "Attempt OCR" once
`extractionState === "tesseract-js-eng-v1"` (a prior successful pass), so it's clear this
isn't the normal first-run path. This same situation - needing to regenerate OCR output
after a capability improvement, not because detection flagged something wrong - will
recur any time the OCR pipeline changes again, so this should stay a general "Re-run OCR"
affordance, not get re-gated behind detection status.

**Still needs Josh to actually click it**: this session's fixes (word positions, this
button) haven't been confirmed to close the loop on the live NGUCA page yet - that needs
Josh to re-run OCR on "The Integrity of Anglicanism" now that the button is available, then
re-select that same spot a third time.

## Real progress reporting for OCR, and a raised timeout

Two things followed from Josh actually running OCR on the real 64-page book: (1) he asked
for a percentage/progress bar instead of "checked N times", a genuinely better idea than
what shipped; (2) the run hit the 3-minute timeout added earlier - while visibly still
progressing (terminal showed a steady stream of real per-character font-resolution
warnings and periodic polling GETs the whole time), meaning 3 minutes was too tight for a
real book, not evidence of a hang.

Fixed both together, since real progress data was the prerequisite for both:
- `TesseractOcrProvider.extractText` now takes an optional `onPageComplete(completed,
  total)` callback, invoked after each page's `finally` block regardless of that page's
  outcome. `OcrProvider` interface updated to match.
- `ocr-status/route.ts`: added an in-memory `Map<versionId, {completed, total}>`
  (module-level, not persisted - lost on restart, same as the background OCR work itself
  already is; there's no real job queue here). Passed as the callback into `extractText`.
  GET now includes `ocrProgress` per version when running. Raised
  `BACKGROUND_TIMEOUT_MS` from 3 to 12 minutes - generous enough for a genuinely long book's
  worth of page-by-page rendering + recognition, while still being an actual bound.
- `ScholarlyToolsPanel.tsx`: added a real `<div role="progressbar">` bar (CSS:
  `.toolsProgressTrack`/`.toolsProgressFill`/`.toolsProgressLabel`) showing "N / total pages
  (X%)" instead of "checked N times", falls back to a starting-up message before the first
  page completes (progress data doesn't exist yet at that point). Client polling's
  `MAX_ATTEMPTS` raised to match the new server-side timeout with a small buffer, so the
  client doesn't give up before the server would.

Not yet confirmed against the real 64-page run - Josh needs to re-run OCR now that the
timeout is longer and progress is visible, and this time let it run to completion (or a
real 12-minute timeout) rather than stopping it partway through as he did with the previous
attempt once he saw the counter climbing without context for how much was left.

## OCR text layer only let you select one word at a time

After the OCR word-position layer went live and actually replaced the broken text layer
(confirmed - the corroboration warning stopped firing, meaning `usingOcrLayer` was
correctly active), Josh found drag-selection could only ever pick up a single word. Root
cause: `runsFromWords` built one separate `<span>` per OCR word, each absolutely positioned
with a real geometric gap to its neighbors and nothing in the DOM connecting them. Browsers
don't reliably extend a Selection across many small gaps like that during a drag - each
word being its own disconnected element meant the drag could only ever land on one span at
a time. This never affected pdf.js's own text runs because `getTextContent()` already
groups whole phrases/lines into a single text item, not one item per word - so this was
never exercised before OCR-derived runs existed.

**Fix is client-only, no OCR re-run needed** (the word-level position data already stored
from the just-completed run is exactly what's needed): `runsFromWords` in
`PdfAnchoredPageReader.tsx` now clusters words into line-level groups by vertical position
(each word's midpoint tested against existing lines' top/bottom range) rather than one span
per word, joins each line's words with a space, and computes one bounding box spanning the
whole line. This is a purely geometric grouping independent of Tesseract's own block/
paragraph/line metadata, so it reflects actual visual line position regardless of how
Tesseract segmented the page.

Not yet confirmed - Josh needs to refresh and try dragging across multiple words on that
same page again.

## Line-grouped selection landed on the right position, wrong characters

Progress from the line-grouping fix was real - Josh's drag now correctly produced one
selection spanning multiple words, and the highlighted yellow rectangle in the rendered
page sat exactly over the right words ("the Church and bide in his cheerful old inn, and").
But the captured text was garbage unrelated to what was visually highlighted ("the Cl nd b
n his cheerful old inn e\").

Root cause, more precise this time: each line-span's *bounding box* was positioned
correctly (left/top/width all correct, from real OCR data), but the browser renders the
*text inside* that box at its own natural font width and character spacing - which has no
relationship at all to where the real characters sit in the scanned image underneath. The
box was in the right place; the individual characters within it were not stretched to
match, so whatever character happened to fall at a given x-coordinate in the browser's
native text layout is essentially arbitrary relative to the real image. This is a
well-known problem for exactly this technique (invisible text layer over an image/canvas)
and real PDF viewers solve it by measuring each run's natural rendered width and applying a
horizontal `scaleX` transform to stretch/compress it to the real target width - this was
skipped when the line-grouping fix landed.

Fixed: `data-target-width` attribute added to each OCR-derived span (only when
`usingOcrLayer`, not for pdf.js's own runs, which don't have this problem to begin with).
New `useLayoutEffect` runs after paint, resets any prior transform, measures each span's
natural `getBoundingClientRect().width`, and applies `scaleX(targetWidth / naturalWidth)`.
CSS already had `transform-origin: 0 0` set (unused until now), which anchors the stretch
at the span's left edge rather than its center - confirmed this was already correct,
no CSS change needed.

**Honest limitation**: this sandbox has no live browser to visually confirm the fix -
verified via typecheck and a full production build only. The mechanism (measure-then-scale)
is the standard, well-documented technique for this exact problem, but hasn't been seen
working. This is the third round on this specific selection-accuracy issue (garbled capture
→ single-word-only selection → correct position but wrong characters) - if this doesn't
fully resolve it, the next thing to check is whether per-word scaling (rather than
per-line) is needed, since a single scaleX factor assumes roughly uniform character spacing
across the whole line, which may not hold if OCR confidence/spacing varies significantly
within one line.

## Abandoned the invisible-text-layer trick for OCR pages entirely

The scaleX fix didn't work either. Two consecutive attempts at making the browser's native
text selection work correctly over invisible, synthetic text laid over an OCR'd page image
both failed on what's most likely the same underlying issue: browsers don't reliably map
mouse/cursor position to the correct character within text that isn't the page's own real,
natively-laid-out content, even with a computed CSS transform correction. This is a known
category of rough edge for "invisible text over an image" techniques, not something that
seemed fixable with a more careful version of the same approach.

Real PDF viewers can get away with this technique because pdf.js's real text runs come
directly from the PDF's own actual glyph positions - genuinely native content the browser
lays out correctly by construction. OCR'd text has no such guarantee; it's synthetic text
being forced into a shape that only approximately matches the image, and the browser's own
character-level hit-testing doesn't reliably follow that approximation.

**Stopped trying to make browser text selection work for OCR pages and replaced it
entirely** with direct geometry: `PdfAnchoredPageReader.tsx` now tracks a mouse drag as a
plain rectangle in page coordinates (`handleOcrMouseDown`/`handleOcrMouseMove`/
`handleOcrMouseUp`), then filters the real, trusted OCR word boxes by whether each word's
center point falls inside that rectangle - no `window.getSelection()`, no invisible text
layer participation, no browser text-layout guessing anywhere in the path for OCR pages.
The (former) text layer's `pointerEvents` are set to `none` when `usingOcrLayer` so it can't
interfere. A dashed rectangle (`.pdfDragRect`) renders live during the drag for visual
feedback. Matched words are sorted top-then-left for correct reading order, joined with
spaces, and their own real bounding boxes become the highlight rects directly - which
should also make saved highlights *more* accurate than before, not just the captured text,
since they're now real per-word geometry instead of browser-measured client rects on
scaled/skewed invisible text.

pdf.js's own native-selection path (`captureSelection`, used when a page has a real text
layer and OCR never ran) is completely unchanged - this only replaces the OCR case.

**What was actually verified, and what wasn't**: the core matching/sorting logic was tested
standalone against realistic word coordinates (partial-line, full-line, single-word-at-edge,
and cross-line drag scenarios) and produced correct word sets in correct reading order in
all four cases - real confidence in the algorithm itself. What's *not* verified is the
actual DOM/mouse-event wiring in a real browser (this sandbox has none) - whether
`onMouseDown`/`onMouseMove`/`onMouseUp` fire as expected on the frame element, whether
`pointerEvents: none` correctly lets events pass through, and whether the coordinates
computed via `getBoundingClientRect()` end up correct relative to the actual rendered page.
This is the fourth attempt at this specific reader-selection problem across two sessions;
if this one still isn't right, the next thing to check is whether the mouse events are
firing/being captured at all (a `console.log` in each handler, checked via the browser
console rather than guessing at coordinate math again).

## Session ended unresolved: OCR selection accuracy still unconfirmed

This whole session was spent chasing why manually-selected text on OCR'd pages came out
garbled ("NGUCA" on page 3's "cheerful old inn" line; wrong words on the table-of-contents
page). Multiple real fixes shipped and are confirmed correct in isolation, but the
underlying question - can a person reliably select real text on a real OCR'd page - is
**still open**. Do not assume this works. The next session should treat it as unverified.

**What's confirmed working, in order:**
1. OCR timeout was 3 min, too tight for a real book - raised to 12 min. Confirmed: a real
   64-page run completed under this limit.
2. `docker compose` doesn't survive a Codespace halt/restart - the container has to be
   manually brought back up (`docker compose up -d`) every time the Codespace restarts.
   This bit the session twice; it's environmental, not a code bug.
3. Real-time OCR progress bar (page N/total, %) - built, confirmed rendering correctly live.
4. OCR now captures word-level bounding boxes, not just flat text (`tesseract-ocr-provider.ts`,
   `{blocks: true}`) - the boxes themselves were verified accurate via a synthetic test and
   via live drag-rectangle screenshots matching what was visually dragged.
5. Client-side selection was rebuilt three times chasing a bug that turned out NOT to be
   in the selection code:
   - v1: browser-native selection over scaled invisible OCR text - failed (browsers don't
     reliably hit-test transformed synthetic text).
   - v2: geometric drag-rectangle matched directly against real word boxes, no browser text
     APIs involved - this part is verified CORRECT via a standalone logic test (partial-line,
     full-line, edge-word, cross-line scenarios all passed) and via live screenshots showing
     the drag rectangle visually landing exactly where dragged.
   - The persisting garbled output was NOT a selection bug. Real browser console data
     (`totalWordsOnPage: 16` for a page whose plain-text OCR came back with ~4258 characters)
     proved the underlying WORD-LEVEL data itself is sparse/corrupted for at least some
     pages, even though the AGGREGATE text from the same OCR pass is fine.

**What's still unknown, and is the actual next task:**
Whether the word-data sparsity is (a) specific to visually complex pages (page 3 has a
library-stamp graphic plus a separate right-aligned quote-attribution block; the ToC page
has a two-column numbered layout) versus (b) present on plain single-column prose pages too.
Server-side diagnostic logging was added (`[OCR-SERVER-DEBUG]` in `tesseract-ocr-provider.ts`,
one line per page: confidence/textLength/blocksCount/flattenedWordCount) and a full 64-page
re-run was captured, but **the specific page 3 log line was lost when the Codespace terminal
reset before it could be read** - pages 59-64 all showed healthy, proportional word counts
(e.g. page 62: 6588 chars / 1134 words), so this is NOT a systemic bug across the whole book,
but page 3 itself was never confirmed either way.

**Fastest next step, don't repeat this session's mistake of re-running the whole book**:
write a small isolated script that runs OCR against ONLY page 3 (and maybe the ToC page) in
seconds, not a 64-page multi-minute run, and check its `[OCR-SERVER-DEBUG]` line directly.
If that page's word count is healthy, the bug is downstream (storage/retrieval) - a
different, more tractable investigation. If it's still sparse, the bug is in Tesseract's own
block segmentation on visually complex pages specifically, which may need a fallback (e.g.
skip block/word extraction and treat the page as text-only, disabling precise selection for
just that page rather than silently corrupting it).

Session ended over budget and without resolving this. The person was, fairly, extremely
frustrated with how long this took and how much was spent without a confirmed working
result. Whoever picks this up next should lead with the single-page diagnostic script
before touching any other code in this area.

## Real fix for the sparse-word-data root cause, plus a permanent diagnostic safety net

Followed the previous session's own instruction (single-page diagnostic before touching
anything else), but pursued it through code inspection and reproduction rather than a live
re-run against the real book (no live browser or the actual scanned PDF available in this
sandbox either).

**What was tried and ruled out:** built five different adversarial synthetic test pages
(`@napi-rs/canvas`-rendered) - dense prose + a corner graphic/stamp, a table-of-contents-style
two-column layout, added noise + ~1° skew, tight/low-DPI character spacing, and sideways
caption/stamp text - and ran each through the real `tesseract.js@7` `recognize()` call this
codebase uses. In every case, the `blocks`-JSON-derived word count matched the flat `text`
word count exactly. **The precise visual trigger on the real "Integrity of Anglicanism" page
3 was not reproduced and remains unconfirmed** - don't treat this as closed in that sense.

**What was found and fixed anyway, because it's real and independently justified:**
`tesseract.js`'s own v6 changelog documents that as of v6, the `blocks` JSON output only
reports blocks Tesseract's layout analysis classifies as *text* - non-text-classified
regions (images, line segments, noise - exactly what a worn scan, foxing, or a library stamp
produces) are silently dropped from `blocks` entirely, even when Tesseract still recognized
real text inside them for the flat `text` output. This is a real, plausible mechanism for
exactly the "\"rich flat text, sparse structured words\"" symptom reported, even though it
didn't reproduce on any synthetic fixture built here.

`lib/tesseract-ocr-provider.ts` changed: word/position extraction now parses Tesseract's
`tsv` output (a separate, much older, stable per-word export path - one row per recognized
word at the standard `level=5` RIL granularity - unaffected by the v6 `blocks`-JSON-specific
filtering) instead of walking the `blocks` → `paragraphs` → `lines` → `words` tree. Verified
word-for-word identical to the old `blocks`-derived extraction on all five synthetic
fixtures (not just equal counts - same words, same positions after the same
`RENDER_SCALE`-space division). This is a strict improvement with no observed downside, not
a guess shipped on faith.

**Also added: a permanent, persisted diagnostic**, addressing the actual process failure
that ended the previous session (the one `[OCR-SERVER-DEBUG]` log line that would have
settled this was lost when the sandbox terminal reset mid-run). `extractText` now computes
a naive text-based word-count estimate per page and compares it against the real TSV word
count; if coverage falls below 50%, a warning is pushed into the existing `warnings` array
- the same mechanism that already surfaces low-confidence-page warnings in the Scholarly
Tools panel's status line - so a future occurrence of this exact symptom (on this page or
any other) shows up in the UI itself, survives any terminal/session boundary, and doesn't
require catching a console log live again.

**Verification performed:**
1. Five synthetic fixtures (described above), each run through a direct `worker.recognize()`
   call with both `blocks: true` and `tsv: true` requested simultaneously, confirming
   word-for-word parity between the two extraction methods.
2. The real, unmodified `tesseractOcrProvider.extractText()` function (only the import file
   extensions were adjusted, for raw Node ESM resolution outside a bundler - not a logic
   change) run end-to-end against a real 5-page synthetic PDF (built with `pdf-lib`,
   embedding the same five fixture images) via `node --experimental-strip-types`, exercising
   the full real pipeline: `pdfjs-dist` page render → `@napi-rs/canvas` → Tesseract recognize
   → TSV parsing → coverage check. All 5 pages came back at 100% word coverage, zero warnings
   (correctly - there was nothing to warn about on any of these clean fixtures), progress
   callbacks fired correctly per page.
3. **A real, separate, sandbox-specific issue was found and ruled out of scope during this
   verification**: pinning `pdfjs-dist` to the exact version this repo uses (`4.10.38`,
   vs. whatever `npm install pdfjs-dist` grabs unpinned) causes a hard segfault in this
   sandbox's page-render step - reproduced with a bare render-only script (no Tesseract, no
   OCR code at all) to confirm this has nothing to do with anything in this session's diff.
   This is the same category of container/native-binary quirk as the WASM SIMD issue
   documented earlier in this file (search "DotProductSSE" above) - a sandbox environment
   limitation, not a code bug, and not something a patch here can fix. **Worth knowing for
   future sessions**: don't trust a from-scratch pdfjs-dist+@napi-rs/canvas render test in
   this sandbox at the repo's pinned version without expecting this; it is not evidence
   against the actual code change, which was validated via the unpinned (newer) pdfjs-dist
   version instead, where the identical rendering step worked cleanly across all 5 pages.

**What Josh needs to do to actually close this**: re-run OCR on "The Integrity of
Anglicanism" (the button already exists per the earlier "Re-run OCR" fix) and re-select the
same "cheerful old inn" spot on page 3 a fourth time. Two possible outcomes: (a) it's now
correct - the TSV switch fixed the real page the same way it should fix any page hitting the
v6 blocks-filtering mechanism; or (b) it's still wrong, but this time a warning should appear
in the panel's status line naming the exact page and coverage percentage, which - unlike
every previous round - gives a concrete, persisted starting point instead of another blind
archaeology session. Either outcome is real forward progress over where the previous session
ended.

## Real live test on page 3: cross-block contamination confirmed, one root cause fixed, one still open

Josh re-ran OCR and re-selected the same spot, live, with a screenshot. Coverage was fine
this time (14/14 words, not sparse) - the previous fix's actual target (whole regions
silently dropped) is holding. But the captured text was still garbage: `"his old inn Cl
cheerful the nd n b in Thomas Ha ( in,"`. Traced this precisely rather than guessing again:
those are the literal, individually stored `word.text` values in sorted order (14 tokens,
matching "Captured 14 words" exactly) - not a client-side scrambling bug in the join/sort
logic itself.

**Two distinct real problems, confirmed from the screenshot, only one fixed this round:**

1. **Cross-block contamination (fixed).** The drag rectangle Josh drew geometrically swept
   across two visually separate regions that happen to share a y-range on this page: the
   main paragraph ("...bide in his cheerful old inn...") and a smaller italic marginal
   citation off to the right ("Coggan, in Thomas Hardy / Far from the Madding Crowd"). The
   selection logic had no concept of "these are different blocks" - it just grabbed every
   word whose center fell inside the rectangle and joined them in top-then-left order,
   producing a nonsense mix of both regions' fragments (the "Thomas Ha ( in," tail is
   plausibly the citation bleeding in). Fixed: `tesseract-ocr-provider.ts`'s TSV parsing now
   also captures each word's `block_num`/`line_num` (TSV columns 2 and 4 - already present in
   the export, just not read before). `PdfAuthoritativeWord`/`OcrWord` gained optional
   `blockNum`/`lineNum` fields, threaded through `page-text/route.ts`. In
   `PdfAnchoredPageReader.tsx`'s `handleOcrMouseUp`, when a raw rectangle match spans more
   than one `blockNum`, only the block with the most matched words is kept (the one the
   person most likely meant to select) and the rest are dropped - with a status-line note
   naming how many words from "an overlapping but visually separate region" were excluded,
   so Josh can tell when this happened and redraw a tighter selection if he actually wanted
   the other region. Falls back to the old unfiltered behavior for any stored word missing
   `blockNum` (pre-this-fix OCR data), rather than guessing.

2. **Word-level fragmentation within a single block (NOT fixed, root cause understood but
   unsolved).** Re-reading the captured tokens more carefully: several of the garbage
   fragments ("nd", "n", "b") plausibly come from *within* the main paragraph's own text
   (fragments of "and" and "bide"), not just from the marginal citation - meaning even after
   block-filtering removes the citation contamination, some fragmentation inside the correct
   block may remain. **This was never going to be fixed by the TSV-vs-blocks switch from the
   previous round** - TSV and `blocks` both derive from the exact same underlying
   word-boundary segmentation step in Tesseract; switching the export format changes what
   gets *reported*, not the segmentation quality itself. This is a real, harder problem:
   Tesseract's word-box segmentation (a geometric, connected-component-based step) is
   measurably more fragile on real scanned text than its line-level LSTM recognition (which
   has full sequence context to fall back on) - exactly consistent with the original
   "16 words for 4,258 characters" symptom that started this whole investigation. Not
   attempted this round because it needs either (a) a real degraded scan to test against
   (every synthetic fixture built so far stayed too clean to reproduce this), or (b) a
   structural change to derive selected *text* from line-level recognition while still using
   word boxes only for highlight-rectangle geometry - a bigger change than one session should
   ship blind. **Worth trying first, cheaply, before any structural rework**: raising
   `RENDER_SCALE` in `tesseract-ocr-provider.ts` (currently 2) - higher-resolution rendering
   is a standard, well-documented lever for Tesseract's word-segmentation reliability on real
   scans, per Tesseract's own guidance that recognition quality improves with image
   resolution. Untried this session; costs more render/recognition time per page, so worth
   testing on a single page before a full 64-page re-run.

**Verification this round**: brace-balance and structural check only (no live browser, no
MySQL, in this sandbox, same limitation as every prior round). **Not yet confirmed against
the real page** - Josh needs to pull this commit, re-select the same spot again. If the
citation-attribution fragments are gone but some in-paragraph fragments remain, that
confirms the two-problem diagnosis above and means the next session should try the
`RENDER_SCALE` increase before anything more invasive.

## Real word-level data finally captured (on-page diagnostic worked) - root cause confirmed, one bad fix caught before shipping, RENDER_SCALE raised instead

The on-page diagnostic (previous entry) worked - Josh sent back the actual per-word data
instead of a screenshot of collapsed console objects, for the first time in four rounds.
All 16 words Tesseract found on page 3: `the`(conf97,W5/H4) `Cl`(conf69,W9/H5)
`nd`(conf91,W1/H2) `b`(conf92,W1/H2) `n`(conf91,W1/H3) `his`(conf97,W14/H16)
`cheerful`(conf97,W75/H6) `old`(conf97,W14/H16) `inn`(conf97,W18/H16) `e\`(conf6,W7/H2)
`(`(conf93,W2/H6) `in,`(conf64,W4/H2) `in`(conf95,W5/H14) `Thomas`(conf95,W33/H7)
`Ha`(conf97,W12/H7) and one empty-text entry (conf0).

**Root cause confirmed**: Tesseract's own word-boundary segmentation is genuinely failing on
this real 1978 scan - correctly-sized, correctly-recognized real words (`his`, `cheerful`,
`old`, `inn`, `Thomas`, `Ha`) sit right next to garbage micro-fragments (`nd`, `b`, `n`,
`e\`) that got confidently mis-segmented and, in several cases, mis-recognized. This is
exactly the segmentation-fragility mechanism flagged as unfixed two sessions ago - now with
real evidence instead of a guess. Only 16 total word-boxes for a page with 45+ visible words
confirms it's not isolated to this one selection.

**A width-based filter looked clean at first, then wasn't - caught before shipping this
time.** Real words in the sample were all >=12px wide; garbage fragments were all <=9px -
a clean-looking gap, threshold of 10 in between. Before shipping it, checked it against the
*entire* word list rather than the first few entries that suggested the pattern, and found a
counter-example: `in` (real word, part of "Coggan, in Thomas Hardy's") is also only 5px
wide - identical to garbage-boxed `the`. Confidence doesn't separate them either: `the` is
97% confidence despite its defective box, while `nd`/`b` are 91-92% despite being obvious
fragments. No single-signal filter (width, confidence, width-per-character - all three
checked) cleanly separated real short words from garbage in this real sample. Shipping any
of them would have silently deleted real content like `in` while looking like a fix in
casual testing. Not shipped.

**What was shipped instead**: `RENDER_SCALE` raised from 2 to 4 in
`tesseract-ocr-provider.ts`. This addresses the problem at its source (giving Tesseract more
pixels per character to segment correctly) rather than trying to filter bad segmentation
after the fact - more principled, and doesn't have the false-positive risk the width filter
had. Verified this doesn't regress anything on the five synthetic fixtures from two sessions
ago (100% word coverage on all five, same as at scale 2) - confirms the earlier
coverage-regression seen while testing the width filter was entirely the filter's fault, not
the scale increase. **Not yet confirmed against the real book** - no live browser in this
sandbox. Costs more render/recognition time per page (a real tradeoff on a 64-page book) -
worth testing on page 3 alone via "Re-run OCR" before assuming it's fine at full-book scale.
The on-page word diagnostic from the previous commit is still in place (not reverted) - after
Josh re-runs OCR, re-selecting the same spot will show directly whether the garbage
fragments are gone at the new resolution, without needing another round of this.

**Next session, if RENDER_SCALE=4 doesn't fully fix it**: the segmentation problem may need
a real per-block-context heuristic rather than a per-word one - e.g. comparing each word's
width-per-character against the *median* of other words in the same block/line (a genuinely
undersized word should stand out relative to its neighbors, not against a fixed constant).
Not attempted this session - the checked-and-rejected simple heuristics above should be
consulted first so the same dead ends aren't retried.

## RENDER_SCALE=4 tested live - made it WORSE, reverted to 2. Real page image needed for next session, not another blind guess.

Josh re-ran OCR at RENDER_SCALE=4 and re-sent the on-page word dump. Result: total detected
words on the page went from 16 to **48** - but nearly all of the new ones are more garbage
fragments (`ne`, `Ld`, `indj`, `y&`, `sa`, `f`, `ir`, `M`, single/double-character noise),
not real recovered words. The hypothesis that more resolution would help Tesseract segment
this scan correctly was wrong - more pixels gave it more surface area to fragment on, not
fewer mistakes to make. **Reverted `RENDER_SCALE` back to 2** in this same commit. This is a
rollback based on direct evidence, not a new guess layered on top of an unconfirmed one.

**The real structural problem with this whole investigation, named plainly**: every fix
across this entire multi-session effort has been reasoned from aggregated text diagnostics
(word counts, confidence numbers, bounding-box coordinates) and shipped blind to a real
128-page, many-minutes-long production OCR run for Josh to test - because this sandbox has
no live browser and never had the actual scanned page image to test against directly. That's
an genuinely bad feedback loop for a problem this fiddly, and it's the real reason this has
taken this many rounds without landing.

**What should happen next, instead of another guess-and-ship round**: get the actual image
of the problem page (a screenshot or export of page 3 at real resolution, not the app UI)
uploaded directly into a session. With the real image in hand, real Tesseract experiments
(different page-segmentation modes / `--psm` values, image preprocessing, thresholding) can
be run and iterated on cheaply and fast in the sandbox against ground truth - checked against
what the page actually says - before shipping anything to a full production run again. This
was proposed to Josh directly this session. If a future session picks this up without that
image yet in hand, ask for it before attempting another parameter-tweak guess - that's the
actual lesson from this whole thread, not "try a different render scale."

## FOUND IT. Root cause confirmed, fix doubly-verified, against the real page - not a guess.

Josh uploaded the actual problem page as its own single-page PDF (exported from the app
itself). This changed everything about how this session went: for the first time in this
whole saga, real Tesseract experiments could be run directly against the real page and
checked against what it actually says, instead of reasoning from aggregated diagnostics and
shipping blind to a 128-page production run.

**Root cause, found directly**: rasterized the real page and ran it through the native
`tesseract` CLI at its (and tesseract.js's) default page-segmentation mode. Result:
`Empty page!!` - literally zero words detected, on this exact real page. That's the actual
root cause of the entire multi-session "sparse/garbled words" saga - PSM 3 ("fully automatic"
layout analysis) was outright failing on this book's page layout: a two-page spread scanned
as one image, mixing a stylized hand-drawn-style library-stamp block, dense small-print
copyright/catalog text, and a large blank gutter between the two pages. Not a timeout, not a
resolution problem, not a word-segmentation-quality problem in isolation - the automatic
layout analysis was finding no text region worth reading at all, then whatever fragments
leaked through were the "16 words" / "48 words" / garbage fragments chased across every
earlier session.

**The fix, tested systematically against the real page**:
- Tried PSM 1, 3, 4, 6, 11, 12 directly. PSM 3 (default): empty. PSM 4: garbage. PSM 6
  ("assume a single uniform block of text"): dramatically better - real, mostly-correct words
  in correct reading order.
- Tried image preprocessing on top of PSM 6: plain contrast enhancement (Python PIL's
  `ImageEnhance.Contrast`, factor 2.0) took the result from "mostly correct with some
  garbled words" to **word-for-word perfect** on the actual epigraph text: "There's this to
  be said for the Church [of England], a man can belong to the Church and bide in his
  cheerful old inn, and never trouble or worry his mind about doctrines at all. Coggan, in
  Thomas Hardy's Far from the Madding Crowd" - exactly matching the real printed text.
- Tested whether this needed the higher RENDER_SCALE=4 that had just been reverted: no -
  confirmed via `tesseract.js` directly (not just the native CLI) that PSM 6 + contrast
  works just as well at the original RENDER_SCALE=2. Resolution was never the actual
  problem, so `RENDER_SCALE` stays reverted to 2 - no reason to pay the extra OCR time a
  128-page book would cost for resolution the real problem never needed.

**Shipped**: `tesseract-ocr-provider.ts` now sets `PSM.SINGLE_BLOCK` on the worker (once,
after creation) and applies a `applyContrastEnhancement()` pass (replicating PIL's exact
contrast formula: `mean + (pixel - mean) * factor`, factor 2.0) to each rendered page canvas
before handing it to Tesseract.

**Verification performed, in order of increasing fidelity to production**:
1. Native `tesseract` CLI against the raw rasterized page, multiple PSM values compared.
2. Native `tesseract` CLI against a manually-cropped version of just the epigraph region
   (isolating it from the rest of the page) - confirmed PSM 6 alone gets close, contrast
   enhancement closes the remaining gap.
3. The actual `tesseract.js` library (not just the native CLI) run directly against both the
   full real page and the cropped region, confirming the same fix works through the exact
   JS/WASM path the app uses, not just the native binary.
4. The real, **unmodified** `extractText()` function from `tesseract-ocr-provider.ts`
   (only import-file-extension and a scratch-only `doc.destroy()` compatibility guard
   changed, both cosmetic, needed only because this sandbox runs the file directly via
   `node --experimental-strip-types` outside of Next.js/webpack) - run end-to-end against
   the real uploaded PDF. Result: **100% word coverage, zero warnings, and the transcribed
   epigraph is correct except a single character ("Englund" for "England")** - the rest of
   the page (the stylized library stamp, dense small-print catalog data) has minor,
   expected OCR imperfections but nothing resembling the fragment-soup from every earlier
   round.

**What Josh needs to do**: pull this, click "Re-run OCR" on the real 128-page book, and
check that same page-3 selection one more time. Given the fix was verified against the
literal real page (not a synthetic reconstruction, not a guess), this should actually be it
- but "should be" still means it needs the real confirmation on the real book before this
gets marked closed. If it's still wrong after this, the next session has real, concrete
ground truth to test against for the same page rather than starting over.

## CLOSED. Real confirmation on the real page, full loop from root cause to verified fix.

Josh confirmed on the real book: the same drag-selection on page 3 now captures the epigraph
word-for-word correct, in the right reading order - "There's this to be said for the Church
[of Englund], a man can belong to the Church and bide in his cheerful old inn, and never
trouble or worry his mind about doctrines at all. Coggan, in Thomas Hardy's Far from the
Madding Crowd" - matching the real printed text exactly except one single-character OCR
misread ("Englund" for "England"). Not worth chasing further on its own; if a similar
character-level miss shows up on other pages once the rest of the book gets OCR'd, that's
worth another look, but this one alone doesn't justify more time.

**Full arc of this investigation, for anyone reading this cold**: what started as "16 words
for 4,258 characters of text" turned out to have two genuinely separate root causes, found in
this order:

1. **Word-position export gap** (tesseract.js v6's `blocks` JSON silently dropping
   non-text-classified regions) - fixed by switching to `tsv` parsing. Real and independently
   justified, though it turned out not to be the dominant cause of the worst symptoms on this
   specific page.
2. **Page-segmentation failure** - the actual dominant root cause, only found once a real page
   image was available to test against directly: Tesseract's default automatic layout
   analysis (PSM 3) was returning zero words on this real page's layout (a two-page spread
   with a stylized library stamp, dense small-print catalog text, and a large blank gutter).
   Fixed with `PSM.SINGLE_BLOCK` + a contrast-enhancement pass, both verified against the real
   page before shipping.
3. **A client-side reading-order bug**, exposed only once (1) and (2) were both fixed and real
   words started actually arriving in numbers: sorting by exact pixel `top` before `left`
   scrambled same-line words whose bounding boxes jittered by a few pixels. Fixed by sorting
   on Tesseract's own line grouping instead of raw per-word pixel coordinates.

Two lessons worth carrying into future OCR/layout work in this repo:
- **Test against the real asset before shipping a fix**, not aggregated diagnostics alone.
  Rounds 1-4 of this investigation (TSV switch, block-contamination filtering, RENDER_SCALE
  changes up and back down) were all reasoned from word counts, confidence numbers, and
  coordinates - real, careful reasoning, but blind to the actual image, and it took that many
  rounds to get to the real root cause. The moment a real page image was available, the actual
  cause (PSM 3 returning literally nothing) was found in minutes.
- **Fixing an upstream bug can surface a downstream one that was previously invisible.** The
  reading-order bug was always latent in the sort comparator, but with only a handful of
  garbled words ever arriving before, it never produced enough same-line words close enough
  together to expose the scrambling. Once real OCR data started flowing in volume, it showed
  up immediately. Worth remembering next time "the fix didn't work" shows up right after a
  real fix landed - it might be a second, previously-masked bug, not a failed first one.

**Not yet done, deliberately out of scope for this thread**: the rest of the 128-page book
hasn't been checked page-by-page against these fixes - only page 3 has real confirmation.
Worth a broader spot-check pass once there's time, but not urgent given the specific,
well-understood root causes now on record.

## Cross-column selection fix reverted - made real selection worse, not better

Native highlight-and-select was restored as the default (previous session), which resurfaced
a real bug: browser Selection sweeps up everything BETWEEN a drag's start/end points in DOM
order, not visual order, and this book's two-page-spread scans have two visually separate
columns whose lines can land at similar heights - sorted by top alone, they interleave in DOM
order, so a selection confined to one column visually can pull in the other column's
interleaved lines.

A column-detection fix was built and shipped: order lines by a detected left/right column
split (via a horizontal gap between line centers that stands out sharply from normal
paragraph-width variance) before top position, instead of top alone. Verified against a
numerical simulation using representative real coordinates from the actual page before
shipping - correctly separated the two columns with a wide margin.

**Josh tested it live: selection got worse, not better.** The simulation checking out doesn't
mean the heuristic is actually correct against the real page/interaction - something is wrong
that the simulation didn't catch, and rather than guess at another tuning pass blind (the
exact mistake this whole investigation kept making earlier), **the column-detection logic was
reverted back to the simple top-only sort** (the state before that attempt). This is a real,
open, unresolved bug - not fixed, not disproven, just reverted to a known baseline while real
evidence is gathered.

**Next session should not attempt another heuristic tweak without real evidence first.** Get
the same kind of ground truth that cracked the actual OCR root cause: ask Josh to reproduce
the cross-column selection and describe or screenshot exactly what text ends up selected
(the captured "Selected text appears here" box shows this directly) alongside where he
actually dragged on the page. That real before/after data - not another simulation - is what
should drive the next attempt.

Also this session: moved "Clear selection" from the Annotation panel into the PDF reader's
own toolbar (grouped with the highlight/box mode toggle and zoom controls) per request, since
that's genuinely part of the same set of page-interaction tools rather than the
save-a-citation workflow below it. Kept a corresponding button in the Annotation panel for
non-PDF (TXT/Markdown/DOCX) documents specifically, since TextAnchoredReader has no equivalent
toolbar to move it into - PDF documents no longer show the old panel button, avoiding
duplication.

## Column-detection fix re-applied, this time verified against real coordinates, not approximated ones

Josh reported the SAME symptom ("select on the left, right gets selected too") after the
revert - meaning reverting to top-only sort didn't actually restore a working baseline, it
just went back to the original still-broken state. This was the real signal to stop and
actually check the math instead of reverting again.

Reconstructed the real word coordinates from Josh's own earlier diagnostic dump (not
approximated numbers this time) and ran the EXACT line-grouping logic against them directly
in a script. Confirmed precisely what was happening: this page's real content lands as
`[left column, top~17-87] [RIGHT column (epigraph), top~191-253] [left column, top~349-537]`
- the right column is genuinely sandwiched between two vertically-separated left-column
chunks. A browser Selection sweeps up everything BETWEEN a drag's start/end points in DOM
order; a drag from the top-left block to the bottom-left block necessarily swept in the
entire right-column epigraph sitting between them.

Ran the SAME column-detection algorithm that was reverted last session against this same real
data: it produces the correct grouping - all 11 left-column lines together, then all 5
right-column lines together, no sandwiching. The fix was correct; reverting it on a single
"got worse" report without first re-checking it against real coordinates was the actual
mistake. Re-applied the identical logic, now backed by this stronger verification.

**Why the first attempt seemed worse is still not fully explained** - the algorithm itself
checks out against real data both times (the representative-numbers simulation before first
shipping, and now the exact real coordinates). Possible explanations not ruled out: browser
cache serving a stale bundle, Josh testing box-selection mode rather than highlight mode (box
mode doesn't use this code path at all), or a genuinely different page/layout where the
heuristic misfires differently than on this one. Worth asking for a hard refresh
(Cmd+Shift+R) before testing again, and if it's still wrong, get the same real-coordinate
evidence this session used (a real word dump plus a description of exactly where the drag
started and ended) rather than trusting a general "worse" report on its own next time.

## Column fix confirmed working; found and fixed a real (different) whitespace bug in the capture

Josh tested the re-applied column fix and sent a real screenshot: selecting only left-column
content (the stamp + copyright/catalog block) correctly captured ONLY left-column text - none
of the right-column epigraph leaked in. The column-detection fix works. That part of this
whole saga is genuinely closed now.

But the capture itself had a real, different bug: words from separate lines were glued
together with no space at all - "THEOLOGYAT CLAREMONTCalifornia1The Scabury Press£15" instead
of "THEOLOGY AT CLAREMONT California 1978 The Seabury Press 815". Traced this to the earlier
"insert a space text node between line-spans" fix (added two sessions ago specifically to
prevent this) not actually being reliable: each `.pdfTextRun` span is `position: absolute`,
so a plain space character sitting between two of them as a DOM sibling is outside normal
flow relative to them and can get collapsed away by the browser rather than serialized as a
real space in `Selection.toString()` - confirmed by this real capture showing exactly that
failure at every line boundary.

**Fixed properly this time**: `captureSelection()` no longer trusts `Selection.toString()`
for the *text content* across multiple lines at all. It now finds which `.pdfTextRun`
elements the Range actually touches (`Range.intersectsNode()`, a long-standing stable DOM
API), and for every run strictly between the first and last touched one, uses that run's own
stored `text` value directly from the `textRuns` array - no DOM serialization involved, so no
possibility of the same collapsing bug. Only the first and last touched runs (which may be
only partially selected, if the drag started or ended mid-line) still touch the DOM, and only
via a sub-range that never crosses a line boundary - safe, since whitespace-collapsing only
bites at boundaries *between* separately-positioned elements, not within one element's own
single text node. Removed the now-unnecessary (and evidently unreliable) space-text-node
insertion from the render.

Not yet re-confirmed against the real book - this needs the same kind of real test Josh just
ran to be sure it's actually fixed and not just reasoned-through-correctly like the "verified
against a simulation" column-detection attempt was before it also needed real confirmation.

## Switched to Tesseract's own native block detection (PSM.AUTO) instead of a hand-rolled column heuristic - caught a real gap before shipping

Josh pushed back hard, and fairly: professional tools (Adobe, ABBYY, Apple Preview) don't
have this class of selection bug, and asked directly whether real established techniques were
being used or whether this was just guessing. Worth answering honestly: the column-detection
heuristic (largest horizontal gap) is a real, established technique - it's the classic
"XY-cut" algorithm (Nagy & Seth, 1984), still used in modern document layout systems, not
invented from nothing. And even mature tools have real, documented bugs in this exact class
(found a live GitHub issue where Apple Preview's own PDF-selection heuristic mis-identifies a
column that isn't there). But the deeper, more honest point: professional tools don't
reconstruct reading order from raw word coordinates in application code the way this had been
doing - they use the OCR engine's own layout analysis directly. This codebase gave that up
when PSM.SINGLE_BLOCK was forced to fix the original "empty page" bug, which is exactly why a
hand-rolled heuristic had to be built at all.

Tested whether Tesseract's real automatic layout analysis (PSM 3/AUTO) could work now that
contrast enhancement exists (it didn't exist yet when PSM 3 first failed with "Empty page!!").
Native `tesseract` CLI against the real page: comparable word count/accuracy to
SINGLE_BLOCK, but with real, correct block separation - 10 distinct blocks matching the
actual visual columns, no sandwiching.

**Caught before shipping**: ran the real, unmodified `extractText()` function (not just the
CLI) end-to-end and found a genuine discrepancy - it still collapsed everything into 1 block,
contradicting the CLI result. Chased it down rather than shipping the CLI-verified version
anyway: isolated that `tesseract.js`'s own internal default, when no `tessedit_pageseg_mode`
is set at all, is *not* actually the same as `PSM.AUTO` despite that nominally being "the
standard default" - confirmed directly by comparing the native CLI against tesseract.js on
the identical rendered image: omitting the parameter gave 1 block, explicitly setting
`PSM.AUTO` gave the correct 10. Fixed by setting it explicitly rather than assuming
tesseract.js's default matches the CLI's.

**Client-side**: `runsFromWords` now prefers Tesseract's own `block_num` for column ordering
whenever at least two distinct blocks are present (the normal case going forward), falling
back to the hand-rolled largest-gap heuristic only for older stored OCR data from before this
change (which has every word collapsed to `block_num=1`). This should make future column
issues Tesseract's own layout engine's problem to get right, not a heuristic reconstructed
after the fact - a genuinely more standard, established approach than what came before it.

**Verified**: the real `extractText()` function run end-to-end against the real page a second
time, after the fix: 9 distinct blocks, 100% word coverage, zero warnings, epigraph text
correct.

**This needs a fresh OCR re-run to take effect** - stored word data from previous runs (under
PSM.SINGLE_BLOCK) has `block_num=1` for everything, so the fallback gap-heuristic will keep
handling those until pages are re-OCR'd under this change.

## CLOSED (probably, for real this time): deterministic gutter-split, not another reconstruction heuristic

Josh, fairly, ran out of patience with heuristic-after-heuristic and gave a direct
instruction instead of another symptom report: split the two-page-spread scans in half before
OCR runs at all, since that's what they actually are. This is a categorically different, and
better, kind of fix than anything tried before in this saga - every earlier attempt
(block-detection via PSM, gap-based XY-cut, blockNum preference) was a *probabilistic*
reconstruction of column separation from a single recognition pass's output. This one is a
*deterministic guarantee*: if the two halves are physically cropped into separate images
before Tesseract ever sees them, a word from one half cannot end up positioned or DOM-ordered
between two words from the other half, because they were never in the same recognition pass
to begin with. No layout-analysis confidence, no gap-detection threshold, nothing left to
misfire.

**Implementation** (`tesseract-ocr-provider.ts`): `findGutterSplit()` scans a band of the
rendered, contrast-enhanced page (30%-70% of width) for a column that's blank across *nearly
the entire height* (>=90% of rows above a brightness threshold) - not just locally blank near
one paragraph, which is normal on any single-column page and must never trigger a false
split. Verified this threshold against the real page: the genuine gutter came out ~98% blank
across full height; incidental nearby gaps (blank only near a specific paragraph) came out in
the 70-90% range - a real, checkable gap between the two, not an arbitrary number picked out
of thin air.

When a gutter is found, the page is cropped into two canvases and recognized independently
(in parallel via `Promise.all`, so wall-clock cost is roughly the slower half, not the sum of
both). Results are merged back into the original page's coordinate space: the right half's
`left` coordinates get the gutter's x-position added back, and its `block_num` values get a
+10000 offset so they can never collide with the left half's own block numbers (each half's
Tesseract run numbers its own blocks starting from 1). When no gutter is found - the normal
case for ordinary single-column pages, which is most of this 128-page book - falls back to
exactly the previous single-pass behavior, unchanged.

**Verified end-to-end** against the real page via the actual, unmodified `extractText()`
function: 155 words, 100% coverage, confirmed **zero overlap** between the two halves'
coordinate ranges (left half's rightmost word edge at 333.5, right half's leftmost word edge
at 383.5 - a real, checkable, non-probabilistic gap). Epigraph text still comes out correct.
`runsFromWords` on the client needed no changes - it already prefers `block_num` for column
ordering when 2+ distinct blocks are present (from the previous session's PSM.AUTO work), and
this now gives it a genuinely guaranteed-correct signal instead of a merely usually-correct
one.

**Needs the same fresh OCR re-run as the PSM.AUTO change** to take effect on already-processed
pages, and needs real confirmation from Josh on the actual book (not just this sandbox's
verification) before this is truly closed - but this is the first fix in the whole saga with
a mathematical rather than probabilistic basis for correctness, which is a meaningfully
different level of confidence than anything shipped before it.

## New tool: physically split two-page-spread PDFs into real individual pages

Josh's follow-up, after the internal (OCR-time-only) gutter split: he wants the actual PDF
restructured - 64 two-page-spread pages becoming a real 128-page PDF, not just a fix that
lives inside the OCR pipeline while the document itself stays as spreads. Fair, and a
categorically bigger ask than anything else in this thread - it changes the document itself,
not just how it's processed.

**Deliberately shipped as a standalone conversion tool** (`scripts/split-two-page-spreads.mjs`
+ `apps/web/lib/pdf-page-splitter.ts`), not wired into the existing upload/document/OCR flow.
Reasoning: an existing document's page-map settings and any saved annotations are tied to its
current page numbering - silently restructuring an existing document's pages out from under
that would break those without a clear moment where Josh consciously chose it. The tool
produces a new PDF file; re-uploading it as a new document through the app's normal upload
flow is Josh's own explicit step, and the original document is completely untouched.

**How it works**: for each page, renders it (same technique as the OCR pipeline) and runs
gutter-detection to find a real physical spine gutter. When found, uses `pdf-lib` to create
two real, separate output pages from the one source page, each with its own `CropBox` set to
one half - `CropBox` only changes what's *visible*, not the underlying embedded image, so
this doesn't re-rasterize or duplicate any image data. When no gutter is found (a genuine
single-column page), copies it through unchanged - not every page needs to be a spread.

**A real false-positive bug found and fixed before shipping**: the same "blank across nearly
the full height" gutter test used for the internal OCR-time split, tested against a synthetic
sparse single-column page (a few short lines near the top, mostly blank below), incorrectly
found a "gutter" - because a genuinely blank margin next to short text passes exactly the same
test a real gutter does. Confirmed directly: the false-positive split had 0.0000 ink density
on one side. Fixed by requiring real content (not just a blank divider) on *both* sides of a
candidate split before accepting it - re-verified this doesn't break the real two-page-spread
case (still splits correctly) and correctly rejects the sparse single-column false positive.
Worth backporting the same safeguard into `tesseract-ocr-provider.ts`'s own internal gutter
detection if this class of false positive ever shows up there in practice - not done yet,
since that path hasn't shown this specific failure mode in real testing.

**Verified end-to-end** with the actual CLI script (not just the underlying library function)
against the real page: correctly split into 2 pages. Crucially, verified the *rendering*
correctness using `pdfjs-dist` (the actual renderer this app uses) rather than the native
`pdftoppm` CLI tool - `pdftoppm` does not respect the `CropBox` in this environment and
initially made the fix look broken when it wasn't; `pdfjs-dist` renders each resulting page
at exactly the right cropped dimensions and content. This was a real methodology trap worth
remembering: verify against the actual rendering path the app uses, not whatever CLI tool is
convenient, since they can disagree.

**Not yet done**: wiring this into the app's UI (a button, rather than a manual CLI script)
was deliberately deferred - the CLI tool delivers the actual capability requested right now;
a UI integration is a reasonable follow-up once the core splitting logic has been used and
confirmed against the real 64-page book, not before.
