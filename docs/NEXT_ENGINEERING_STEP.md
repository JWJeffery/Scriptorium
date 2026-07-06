# Next Engineering Step

The next engineering step is to harden PDF.js selection anchoring.

## What is now in place

The native browser PDF embed has been replaced with a PDF.js-backed page reader for the current page. It renders the PDF page to canvas, overlays selectable text runs, captures selected text, and sends that captured text into the existing annotation/citation workflow.

## Why the next slice matters

Captured text alone is not a durable scholarly anchor. A serious annotation needs enough location data to recover the mark after reload, after zoom changes, and after later rendering improvements.

## Desired next slice

Persist durable selection anchors for one rendered PDF page:

1. Capture selected text from the PDF.js text layer.
2. Store the current PDF page and mapped book page.
3. Store surrounding context before and after the selection.
4. Store approximate text-run indexes touched by the selection.
5. Store bounding rectangle data where available.
6. Render a visible highlight overlay from the saved anchor.
7. Confirm the highlight, note, locator, and citation survive reload.

Do not expand to Office files, cloud integrations, semantic interrogation, or export systems until this slice works.
