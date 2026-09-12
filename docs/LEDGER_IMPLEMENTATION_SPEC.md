# The Ledger UI migration

This document governs the redesign of Scriptorium's working scholarly reader. It
condenses the design specification reviewed on 12 September 2026 and records the
implementation decisions needed to keep the existing PDF, OCR, annotation, citation,
page-map, split, recovery, and export workflows intact.

## Direction

- The document remains the visual centre of the application.
- Saved records form a left-hand ledger.
- Annotation, source metadata, and page mapping live in a right-hand inspector.
- The inspector is pinnable on wide screens and becomes a drawer on narrower screens.
- Scholarly tools remain mounted inside a separate drawer so OCR and split polling are
  not interrupted when the drawer closes.
- The actual PDF.js canvas, selectable text layer, OCR geometry, and stored page-space
  rectangles remain one transform-scaled unit. The redesign must never reconstruct a
  scanned page as styled HTML text.

## Scope decisions

1. Do not resurrect the hard-coded `DocumentLibrary`; Scriptorium currently has one
   active local document and no mounted server-backed library.
2. Keep the two existing reader citation choices. Expanding the reader to the six-style
   server formatter is separate work.
3. Creating a split document must warn that the reload will discard any unsaved capture.
4. The existing clear action deletes browser-local annotation records only. Its label
   must say so until a database-delete workflow exists.
5. Only current-version saved records may navigate the active reader. Prior-version
   records remain view-only until opening historical versions is supported.

## Migration order

1. Preserve state ownership in `ScriptoriumMilestoneOnePersisted` and divide its render
   into stable semantic regions without moving state or handlers.
2. Place those regions into the Ledger shell without conditionally mounting the reader.
3. Add inspector pinning and responsive drawer presentations using CSS over the same
   mounted tree.
4. Move the always-mounted `ScholarlyToolsPanel` into its drawer.
5. Apply the paper, ink, terracotta, sage, and highlight visual system.
6. Verify accessibility, keyboard focus, reduced motion, and live progress messaging.

## Required regression checks

- A real scanned PDF loads from IndexedDB and from server recovery.
- Native selection remains visible during a drag and captures the intended text.
- OCR box selection remains aligned at multiple zoom levels.
- Page and book-page mapping continue to control generated locators.
- Annotation, note, colour, anchor, citation, and persistence provenance survive reload.
- OCR detection, progress, warnings, rerun, and searchable-PDF download remain available.
- Spread splitting, progress, download, import, reload, and required follow-up OCR work.
- Closing the tools drawer does not cancel OCR or split polling.
- Corpus export, citation regeneration, and expanded source editing remain available.
- Pinning, unpinning, and responsive layout changes do not remount the PDF reader or lose
  its zoom, selection, or rendered page.

