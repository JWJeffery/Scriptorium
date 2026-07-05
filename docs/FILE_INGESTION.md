# File Ingestion

## Ingestion principle

Every file has an original source object and a canonical reading snapshot.

The original object is preserved. The snapshot is what the app uses for reading, annotation, extraction, and page mapping.

## v1

- PDF upload/register
- local metadata entry
- extracted text placeholder
- manual page mapping

## v1.1

- TXT ingestion
- Markdown ingestion
- DOCX conversion to readable snapshot

## Later

- Google Drive import/export
- Google Docs export to snapshot
- Microsoft OneDrive/SharePoint import/export
- PowerPoint and spreadsheet snapshot support
- OCR pipeline for scanned PDFs

## Conversion rule

The app should record conversion metadata:

- source format,
- conversion tool,
- conversion date,
- checksum,
- warnings,
- whether text extraction is complete.
