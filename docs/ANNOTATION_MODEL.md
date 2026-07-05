# Annotation Model

## Ten highlight colors

Scriptorium supports ten highlight color slots. Each slot has:

- a stable key,
- a visual label,
- a default meaning,
- a user-editable meaning.

Default scholarly meanings:

1. Thesis-relevant
2. Primary claim
3. Methodological point
4. Historical datum
5. Primary source quotation
6. Patristic / classical source
7. Ecclesiology
8. Objection / counterargument
9. Citation needed
10. Follow-up question

## Annotation fields

Each annotation should store:

- selected text,
- color key,
- note text,
- tags,
- document id,
- document version id,
- page map id,
- anchor coordinates or text offsets,
- citation ids,
- created and updated timestamps.

## Anchor strategy

Use redundant anchors:

- page index,
- selected text,
- text offsets when available,
- bounding boxes when available,
- surrounding text context.

This reduces data loss when PDF text extraction is imperfect.
