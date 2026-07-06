# Milestone 1 Implementation Notes

## Implemented

The Milestone 1 workflow is implemented as a client-side prototype in `apps/web/components/ScriptoriumMilestoneOne.tsx`, with PDF rendering and anchor capture isolated in `apps/web/components/PdfAnchoredPageReader.tsx`.

It currently supports:

- registering one local PDF,
- storing the PDF blob in IndexedDB,
- storing document metadata and annotations in localStorage,
- reopening the stored PDF blob after browser reload,
- rendering the active PDF page through PDF.js,
- rendering an approximate selectable text layer over the PDF canvas,
- capturing selected text from that text layer into the annotation editor,
- capturing surrounding text context for the selection,
- capturing highlight rectangles for the selection,
- rendering saved highlight rectangles back onto the PDF page,
- editing source metadata,
- defining a simple page-mapping rule,
- calculating the current book page from the PDF page,
- stepping between PDF pages,
- selecting one of ten highlight colors,
- entering or editing selected passage text and a note,
- generating an SBL-style or Chicago-style note string,
- saving and listing scholarly records with PDF page, book-page locator, note, color category, anchor data, and citation.

## Current limitation

The implementation still uses browser-local storage. It proves the interaction model, but it does not yet persist through the Prisma/PostgreSQL data model.

The PDF.js text layer is also approximate. It captures usable selected text, context, and rectangles, but it does not yet normalize text offsets against a server-side extracted text model.

## Storage boundary

This pass uses browser-local storage only:

- IndexedDB for the PDF blob.
- localStorage for document metadata and annotation records.

The Prisma schema already defines the persistent database model. Server-backed persistence should replace the browser-local prototype after the interaction model is proven.

## Acceptance status

Milestone 1 should remain open until the implementation has:

- a build/typecheck run,
- database-backed persistence,
- tests or fixtures for reload recovery,
- tests or fixtures for citation generation,
- tests or fixtures for anchor recovery and highlight re-rendering.
