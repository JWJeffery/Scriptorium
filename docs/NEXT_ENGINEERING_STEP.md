# Next Engineering Step

The next engineering step is to move the proven browser-local Milestone 1 workflow toward verifiable persistence.

## What is now in place

The app has a focused Milestone 1 workflow. It registers a local PDF, stores the PDF blob in IndexedDB, renders the active page through PDF.js, overlays selectable text, captures selected text, stores surrounding context and highlight rectangles, maps the PDF page to the book page, generates a citation, saves the record, and re-renders saved highlight overlays from the stored anchor.

## Why the next slice matters

The current browser-local prototype proves the interaction model, but it is not yet a durable scholarly storage system. The Prisma schema exists; the workflow now needs to use it.

## Desired next slice

Move one saved annotation path from browser-local storage into the database:

1. Add a server action or API route for document registration metadata.
2. Add a server action or API route for page-map persistence.
3. Add a server action or API route for annotation persistence.
4. Add a server action or API route for citation persistence.
5. Keep the PDF blob strategy explicit: local-only for prototype or object storage for durable use.
6. Add a test fixture proving that highlight, note, locator, citation, and anchor data reload from persistent storage.
7. Run build/typecheck.

Do not expand to Office files, cloud integrations, semantic interrogation, or export systems until this slice works.
