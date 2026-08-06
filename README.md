# Scriptorium

Scriptorium is a clean-slate scholarly reading platform for reading, annotating, interrogating, citing, and storing texts and related research artefacts.

It is not connected to Universal Office. It uses a separate product concept, repository, architecture, vocabulary, and data model.

## Product thesis

The durable scholarly object is not merely a file. It is:

> source text + location + book page system + annotation + citation + research question + later retrieval

Scriptorium preserves the original document and stores scholarship as a structured overlay: highlights, notes, citation metadata, page mappings, tags, extracted text, and research trails.

## First milestone

The first complete user flow is intentionally narrow:

1. Upload or register a PDF.
2. Enter or import bibliographic metadata.
3. Open the PDF in a reading workspace.
4. Map the book's printed page numbering to the PDF's internal page index.
5. Highlight selected text in one of ten colors.
6. Add a note.
7. Generate a Chicago or SBL-style footnote using the book page locator.
8. Save and reopen the document with the highlight, note, and citation intact.

## Proposed stack

- Web app: Next.js + React + TypeScript
- Database: MySQL-compatible Prisma schema for the Spaceship/cPanel deployment path
- ORM: Prisma
- PDF rendering: PDF.js
- Citation formatting: CSL JSON + citeproc-compatible engine
- Document conversion: later service layer for Office, Google Workspace, Markdown, and text ingestion

## Repository layout

```text
apps/web/                 Web application
apps/web/components/      Reader, library, citation, and annotation UI components
apps/web/lib/             Shared app constants and types
prisma/schema.prisma      Core relational data model
docs/                     Product and architecture documentation
scripts/                  Development and ingestion scripts
.github/ISSUE_TEMPLATE/   Milestone issue templates
```

## Getting started

Run these in order from the repo root. This assumes a GitHub Codespace or similar dev
container with Docker, Node, and pnpm already available.

### 1. Start MySQL

```bash
docker compose up -d
docker compose ps
```

Wait for `docker compose ps` to show `healthy`, not just `starting`, before continuing.

**MySQL does not survive a Codespace restart** - this has to be run again at the start of
every session. If `docker compose up -d` errors with something like `container with given ID
already exists` (a stale container from a previous session), clear it first:

```bash
docker compose down
docker compose up -d
```

If that still fails, the more forceful fallback:

```bash
docker rm -f scriptorium-mysql-1
docker compose up -d
```

### 2. Set up environment variables (first time only)

```bash
cp .env.example .env
```

### 3. Install dependencies and generate the Prisma client

```bash
pnpm install
pnpm prisma:generate
```

### 4. Run database migrations

```bash
pnpm prisma:migrate:deploy
```

### 5. Start the dev server

```bash
pnpm dev
```

This runs `next dev` for the web app. In a Codespace, open the forwarded port from the
"Ports" tab (default `3000`) or follow the prompt that appears.

### Restarting a stuck dev server

If `pnpm dev` seems hung or stale after a lot of edits, a clean restart:

```bash
pkill -f "next dev"
rm -rf apps/web/.next
pnpm dev
```

No need to restart MySQL or reinstall dependencies for this - it only clears the Next.js
build cache and kills a stuck process.

## Development direction

Do not begin with broad governance. Build one end-to-end reading workflow first. The test of the project is whether a theologian can open a document, mark a passage, preserve the correct book page number, attach a note, generate a citation, and recover the whole scholarly object later.
