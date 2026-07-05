# Citation Engine

## Principle

Scriptorium should not hand-build citation styles. It should use CSL-compatible metadata and citation processors.

## Metadata

Store bibliographic records in CSL JSON-compatible shape. A source record should be editable by the user and linked to one or more documents.

## Required v1 styles

- Chicago Manual of Style, notes and bibliography
- SBL Handbook of Style, notes

## High-priority later styles

- Turabian
- APA
- MLA
- Harvard
- Journal-specific religion/theology styles
- BibTeX export
- BibLaTeX export
- RIS export

## Citation fields

Generated citations must preserve:

- citation style id,
- source id,
- annotation id when attached to a highlight,
- locator type: page, section, paragraph, canon, folio, etc.,
- locator value from the book page map,
- prefix,
- suffix,
- generated text,
- generated timestamp.

## Regeneration rule

Generated citation text is a snapshot. If source metadata or style changes, the app should offer regeneration rather than silently changing old research notes.
