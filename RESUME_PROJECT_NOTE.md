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
