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
- Database: PostgreSQL
- Vector search: pgvector, added after the basic annotation workflow works
- ORM: Prisma
- PDF rendering: PDF.js via a React wrapper or direct integration
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

## Development direction

Do not begin with broad governance. Build one end-to-end reading workflow first. The test of the project is whether a theologian can open a document, mark a passage, preserve the correct book page number, attach a note, generate a citation, and recover the whole scholarly object later.
