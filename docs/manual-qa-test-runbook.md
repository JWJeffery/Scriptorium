# Scriptorium Manual QA Test Runbook

Status: post-ledger QA

Purpose: verify that the completed Scriptorium development ledger is usable for manual test runs before any production-release claim.

This is not a feature gate. It is a manual QA procedure for exercising the all-green development arc.

## 1. Preconditions

Before beginning a QA run:

1. Pull the latest `main`.
2. Install dependencies from a clean checkout.
3. Copy `.env.example` to `.env`.
4. Start the configured database.
5. Run Prisma validation, generation, and migration deploy.
6. Run the normal typecheck and build commands.
7. Open the web app in a browser with a clean local-storage/session state.

Expected result: the app starts without console-blocking errors, and the development ledger dashboard shows all gates green with no active red gate.

## 2. Test corpus

Use four small documents that are easy to recognize during search and citation checks.

Required files:

1. PDF: two or more visible pages, with stable page labels and at least one paragraph on page 2.
2. TXT: three to five short lines, including a distinctive phrase such as `manual QA alpha`.
3. Markdown: heading plus two paragraphs, including a distinctive phrase such as `manual QA beta`.
4. DOCX: heading plus two short paragraphs, including a distinctive phrase such as `manual QA gamma`.

Keep copies of these test files outside the repo. Do not commit proprietary or copyrighted test documents.

## 3. Defect logging standard

For every defect, record:

- defect ID
- date/time
- browser and OS
- test step
- expected result
- actual result
- screenshot or console output when useful
- severity: blocker, high, medium, low
- suspected area: ingestion, reader, annotation, citation, source metadata, exchange, thread, export, search, retrieval, cited output, persistence, UI
- whether the defect reproduces after a refresh

## 4. End-to-end QA scenario

### 4.1 Ingestion smoke test

Run once for each file type: PDF, TXT, Markdown, DOCX.

Steps:

1. Register or upload the file.
2. Confirm the document appears in the reader or workspace.
3. Confirm title/source metadata is visible.
4. Refresh the browser.
5. Confirm the document can still be recovered.

Expected result: each document is readable after reload, and no prior file's text or metadata leaks into the current record.

### 4.2 Annotation and locator test

Run on at least one PDF and one non-PDF document.

Steps:

1. Select a passage.
2. Add a highlight.
3. Add an annotation note.
4. Confirm a visible locator is attached: page for PDF, line/offset style context for text formats.
5. Refresh.
6. Confirm highlight, note, source, and locator recover.

Expected result: annotations remain tied to the correct document/version and retain locator context after refresh.

### 4.3 Citation test

Steps:

1. Generate a citation from an annotated passage.
2. Confirm generated citation text appears with source metadata and locator context.
3. Edit source metadata in the CSL source editor.
4. Save source metadata.
5. Regenerate or review citation output.
6. Refresh and confirm edited source metadata persists.

Expected result: citation text follows edited source metadata without losing annotation or locator linkage.

### 4.4 Citation exchange test

Steps:

1. Export current source metadata as CSL JSON.
2. Export as BibTeX.
3. Export as BibLaTeX.
4. Import a bounded CSL JSON record.
5. Import a bounded BibTeX or BibLaTeX record.
6. Refresh and confirm source metadata persists.

Expected result: title, author/creator, publisher, place, and year survive exchange without corrupting the source record.

### 4.5 Zotero-shaped local compatibility test

Steps:

1. Export source metadata as local Zotero-shaped book-item JSON.
2. Confirm the exported object contains item type, title, creator, publisher, place, and date.
3. Import the same object back into the source record.
4. Refresh and confirm source metadata persists.

Expected result: Zotero-shaped local data round-trips through the existing source model without adding live sync, OAuth, or external service calls.

### 4.6 Research thread test

Steps:

1. Create a research thread with a clear title and description.
2. Add at least two tags.
3. Add ordered thread items:
   - one annotation
   - one citation
   - one source
   - one document
   - one standalone note
4. Reload the thread.
5. Confirm item order and context are preserved.

Expected result: thread reload shows ordered items with available annotation, citation, source, document, locator, note, and tag context.

### 4.7 Thread rendering test

Steps:

1. Render the research thread to Markdown.
2. Render the same thread to RTF.
3. Open or inspect the exported/rendered text.
4. Confirm order, notes, locator text, citation text, source context, and document context are present.

Expected result: both outputs are usable writing artifacts. RTF should open in a Word-compatible editor.

### 4.8 Exact search test

Steps:

1. Search for the distinctive PDF phrase.
2. Search for `manual QA alpha`.
3. Search for `manual QA beta`.
4. Search for `manual QA gamma`.
5. Search for an annotation note phrase.
6. Search for a citation phrase.
7. Search for a thread tag.

Expected result: results are inspectable and link back to the relevant document, source, annotation, citation, thread, and locator context when available.

### 4.9 Similarity retrieval test

Steps:

1. Search with a phrase that is semantically close to one of the distinctive passages but not exactly identical.
2. Confirm returned results include a positive score.
3. Confirm each result remains inspectable with document and locator context.
4. Confirm no generated answer appears in this search mode.

Expected result: similarity retrieval returns source-linked passage records only.

### 4.10 Cited output test

Steps:

1. Ask for a cited output using a query supported by the test corpus.
2. Confirm the response uses recovered passage evidence only.
3. Confirm each point links to evidence IDs and locator/source context.
4. Ask a query unsupported by the corpus.
5. Confirm the system refuses or marks unsupported rather than inventing an answer.

Expected result: supported output is cited; unsupported output is refused or clearly marked unsupported.

## 5. Persistence pass

After completing sections 4.1 through 4.10:

1. Refresh the browser.
2. Restart the app.
3. Reopen the workspace.
4. Confirm documents, annotations, citations, source metadata, thread records, and search/retrieval behavior still work.

Expected result: no critical QA artifact disappears after refresh or restart.

## 6. Pass/fail criteria

A QA run passes only if:

- no blocker or high-severity defects remain
- all file types can be ingested and recovered
- annotations and locators persist
- citations and source metadata persist
- citation exchange does not corrupt source records
- research threads preserve order and context
- thread rendering produces usable Markdown and RTF
- exact search returns inspectable linked records
- similarity retrieval returns linked passage records
- cited output refuses unsupported answers

A QA run fails if any blocker/high defect remains, if data is lost after refresh, or if cited output produces uncited claims.

## 7. QA run summary template

```text
QA run date:
Tester:
Branch/commit:
Browser/OS:
Database state:

Overall result: PASS / FAIL

Scenarios completed:
- Ingestion:
- Annotation and locator:
- Citation:
- Citation exchange:
- Zotero-shaped compatibility:
- Research threads:
- Thread rendering:
- Exact search:
- Similarity retrieval:
- Cited output:
- Persistence pass:

Defects opened:
1.
2.
3.

Release recommendation:
```
