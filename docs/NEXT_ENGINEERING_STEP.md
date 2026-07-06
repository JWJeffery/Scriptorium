# Next Engineering Step

The next engineering step is to replace the native browser PDF embed with a PDF.js-backed reader.

## Why

The current first-pass workflow displays the PDF and persists scholarly records, but it requires the user to paste selected passage text manually. A PDF.js-backed reader is needed for:

- selectable text layer,
- page-aware selection capture,
- highlight overlays,
- bounding rectangles,
- stable annotation anchors,
- better recovery when the document is reopened.

## Desired next slice

Implement direct text selection capture for one rendered PDF page:

1. Render a PDF page through PDF.js.
2. Render the text layer.
3. Capture a text selection.
4. Bind the selected text to the current PDF page and mapped book page.
5. Save the annotation with selected text, note, color, page locator, and citation.

Do not expand to Office files or semantic interrogation until this slice works.
