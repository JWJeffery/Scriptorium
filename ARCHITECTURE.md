# Architecture

## Architectural principle

Scriptorium separates four layers:

1. **Source storage**: original uploaded/imported files.
2. **Canonical reading snapshots**: stable renderable forms, usually PDF plus extracted text.
3. **Scholarly overlay**: annotations, highlights, notes, page mappings, citations, tags, and research threads.
4. **Interrogation layer**: exact search first, semantic search later, grounded answers only when backed by stored passages.

## Document ingestion

The app should preserve the source file and create a versioned reading snapshot.

Initial support:

- PDF: rendered directly.
- TXT: normalized to text pages or a generated PDF snapshot.
- Markdown: rendered to HTML/text and optionally PDF snapshot.

Later support:

- DOCX and Microsoft Office files: convert to a canonical reading snapshot and extracted text.
- Google Docs/Sheets/Slides: export snapshot and metadata through Google Drive integration.
- PowerPoint and spreadsheets: readable snapshot first; fine-grained annotation later.

## Reader workspace

The reader workspace has five panels:

- Document display.
- Highlight palette with ten color slots.
- Annotation editor.
- Page mapping panel.
- Citation panel.

## Location model

Every annotation should store multiple anchors:

- document id,
- document version id,
- PDF page index,
- visible page label if available,
- book page label from the page map,
- text selection,
- bounding rectangles or text offsets when available,
- confidence level.

This redundancy is deliberate. It allows highlights to survive minor text extraction failures and gives citations the correct scholarly locator.

## Citation model

Bibliographic metadata should be stored as CSL JSON-compatible data. Generated citations should store:

- style id,
- locale,
- locator type,
- locator value,
- prefix,
- suffix,
- generated output,
- source metadata version,
- annotation id.

The stored generated citation is a snapshot. The citation can later be regenerated if the style or metadata changes.

## Interrogation model

Initial interrogation is not a free-form chatbot. It begins with grounded retrieval:

- search document text,
- search notes,
- search annotations,
- search citations,
- filter by tag/color/source/author/date,
- collect passages into research threads.

Semantic/vector search should be added only after exact document, annotation, citation, and page-mapping flows are stable.
