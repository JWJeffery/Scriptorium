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
  worker file. First attempt at a fix - manually overriding `GlobalWorkerOptions.workerSrc`
  via `require.resolve` - did not work and was reverted: webpack statically intercepts
  `require.resolve()` calls even through `createRequire`, rewriting them into its own
  internal module IDs instead of real file paths (confirmed with debug logging before
  abandoning it). **Real fix: added `"pdfjs-dist"` to `serverExternalPackages` in
  `next.config.mjs`** (same mechanism already used for `@napi-rs/canvas`/`tesseract.js`) -
  this stops webpack from touching pdfjs-dist at all, so its own internal relative-path
  logic runs against its real, unmodified location in `node_modules`, where the worker file
  genuinely sits. No manual path hacking needed once that's in place.
  **This was verified by actually reproducing the failure**: built a throwaway API route,
  hit it through a real running dev server via HTTP (not a raw Node script, which is what
  let the earlier `.node` bug ship unverified in the first place), confirmed the exact same
  error, applied the fix, confirmed it resolved through the same route, and confirmed a full
  production `next build` also compiles clean. This is the pattern to repeat for any future
  bug in this dependency chain: reproduce through a real request to a real dev server before
  believing a fix, not through an isolated script.
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
