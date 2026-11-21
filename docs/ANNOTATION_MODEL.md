# Annotation Model

## Ten highlight colors

Scriptorium supports ten highlight color slots. Each slot has:

- a stable key,
- a visual label,
- a default meaning,
- a user-editable meaning.

Highlight meanings (shown when highlighting):

1. Thesis
2. Secondary argument
3. Supporting evidence
4. Interesting point
5. Other (purple): named by the reader for each book
6. Other (teal): named by the reader for each book

The two "Other" colours have no fixed meaning. The reader names them for the book being read ("Heresy",
"Liturgy", ...) and the names are kept with that book. Highlights saved with the four colours of the earlier set of
ten (pink, red, gray, gold) keep their colour and their old meaning; those colours are simply no longer offered.

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
