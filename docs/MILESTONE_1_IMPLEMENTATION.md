# Milestone 1 Implementation Notes

## Implemented

The Milestone 1 workflow is implemented as a client-side prototype in `apps/web/components/ScriptoriumWorkflow.tsx`, with PDF rendering isolated in `apps/web/components/PdfPageReader.tsx`.

It currently supports:

- registering one local PDF,
- storing the PDF blob in IndexedDB,
- storing document metadata and annotations in localStorage,
- reopening the stored PDF blob after browser reload,
- rendering the active PDF page through PDF.js,
- rendering an approximate selectable text layer over the PDF canvas,
- capturing selected text from that text layer into the annotation editor,
- editing source metadata,
- defining a simple page-mapping rule,
- calculating the current book page from the PDF page,
- stepping between PDF pages,
- selecting one of ten highlight colors,
- entering or editing selected passage text and a note,
- generating an SBL-style or Chicago-style note string,
- saving and listing scholarly records with PDF page, book-page locator, note, color category, and citation.

## Current limitation

The PDF.js text layer is a first direct-selection implementation. It captures selected text from the rendered page, but it does not yet store bounding rectangles, normalized text offsets, or durable selection context around the passage.

The next slice should persist richer selection anchors:

- selected text,
- page number,
- book page label,
- surrounding text context,
- approximate text-run index range,
- bounding rectangle data where available.

## Storage boundary

This pass uses browser-local storage only:

- IndexedDB for the PDF blob.
- localStorage for document metadata and annotation records.

The Prisma schema already defines the persistent database model. Server-backed persistence should replace the browser-local prototype after the interaction model is proven.

## Acceptance status

Milestone 1 should remain open until the implementation has:

- a build/typecheck run,
- durable text-selection anchors beyond selected text alone,
- database-backed persistence,
- tests or fixtures for reload recovery and citation generation.
