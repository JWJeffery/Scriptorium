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

- **No UI exists for gates 14–17.** All four are real, callable API routes with zero screens
  — `ScriptoriumMilestoneOnePersisted.tsx` (the only real UI component in the app) doesn't
  import or call any of them. This is the natural next body of work.
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
