# Milestone 1 Implementation Notes

## Implemented in first pass

The initial Milestone 1 workflow is implemented as a client-side prototype in `apps/web/components/ScriptoriumWorkflow.tsx`.

It currently supports:

- registering one local PDF,
- storing the PDF blob in IndexedDB,
- storing document metadata and annotations in localStorage,
- reopening the stored PDF blob after browser reload,
- editing source metadata,
- defining a simple page-mapping rule,
- calculating the current book page from the PDF page,
- selecting one of ten highlight colors,
- entering selected passage text and a note,
- generating an SBL-style or Chicago-style note string,
- saving and listing scholarly records with page locator and citation.

## Current limitation

The first pass displays the PDF through the browser's native PDF renderer. Because embedded PDF renderers do not expose reliable text-selection anchors to the surrounding React app, the user must copy or type the selected passage into the annotation field.

The next implementation step is to replace native PDF embedding with a PDF.js text-layer reader so selections can be captured directly and anchored to page coordinates/text offsets.

## Storage boundary

This pass uses browser-local storage only:

- IndexedDB for the PDF blob.
- localStorage for document metadata and annotation records.

The Prisma schema already defines the persistent database model. Server-backed persistence should replace the browser-local prototype after the interaction model is proven.

## Acceptance status

This pass proves the workflow shape, but Milestone 1 should remain open until the implementation has:

- a build/typecheck run,
- a PDF.js text layer,
- database-backed persistence,
- tests or fixtures for reload recovery and citation generation.
