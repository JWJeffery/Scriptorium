# Data Model

## Core entities

### Document

Represents a user-owned text or artefact.

Fields:

- id
- title
- original filename
- media type
- storage path or object key
- created date
- updated date

### DocumentVersion

Represents a stable reading snapshot of a document.

Fields:

- id
- document id
- source checksum
- snapshot type
- snapshot path
- extracted text status
- created date

### Source

Represents bibliographic metadata, preferably CSL JSON-compatible.

Fields:

- id
- document id
- CSL item JSON
- short title
- author/editor labels
- publication date
- publisher/journal
- created date
- updated date

### PageMap

Maps internal page indexes to scholarly book page labels.

Fields:

- id
- document version id
- pdf page index
- visible page label
- book page label
- numbering system
- confidence
- note

### Annotation

Represents a highlight, marginal note, or selection-bound observation.

Fields:

- id
- document id
- document version id
- page map id
- color key
- selected text
- note
- tags
- anchor JSON
- created date
- updated date

### Citation

Represents a generated citation attached to an annotation or source.

Fields:

- id
- source id
- annotation id
- style id
- locator type
- locator value
- prefix
- suffix
- generated text
- created date

### ResearchThread

Represents a research trail or thematic collection.

Fields:

- id
- title
- description
- tags
- created date
- updated date

### ResearchThreadItem

Links annotations, citations, or documents into a research thread.

Fields:

- id
- research thread id
- item type
- item id
- note
- order index

## Design rule

Never store a highlight as color alone. Color is a visual encoding of a scholarly category. The app must allow the user to rename what each color means.
