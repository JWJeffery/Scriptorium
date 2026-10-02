# Features added after Milestone 18, and how to run them

## Reading
Search (Ctrl+K or `/`), exact words or by meaning; go to a printed book page; bookmarks (`b`);
click a highlight to open its note; margin markers for notes; fit-to-width; the app resumes at
the last page read; unsent drafts survive a reload; keyboard help (`?`).

## Research
Research threads (collect passages, reorder, export to Markdown or Word with real footnotes),
tags, annotation export (CSV, Markdown, Word).

## Sources and citations
Look up a book by ISBN or an article by DOI; import BibTeX, RIS or CSL JSON (Zotero exports).
Citations come from the official CSL styles in `apps/web/csl` (citeproc-js) and warn about
missing metadata. Page-numbering ranges (e.g. Roman numerals for a preface) are saved per book.

## Meaning search
A small local model (all-MiniLM-L6-v2, downloaded once from huggingface.co and checked by
SHA-256) turns passages into vectors; build the index in Scholarly tools > Meaning.
Set `SCRIPTORIUM_MODEL_DIR` to keep the model somewhere permanent.

## Backup
Scholarly tools > Backup downloads a ZIP of the database and PDFs. Restore with
`node scripts/restore-backup.mjs <file.zip>` (only into an empty database).

## Sign-in
`/login` page with a 14-day cookie. Set `SCRIPTORIUM_AUTH_USER` and `SCRIPTORIUM_AUTH_PASSWORD`
(see `.env.example`). Basic auth with the same credentials still works for scripts such as a
scheduled `curl -u` backup. Limits: 8 failed logins per 15 minutes per address; heavy jobs 20/min.
Sessions are stateless, so "Sign out" clears the cookie in the browser, but a stolen cookie
stays valid until the password (or `SCRIPTORIUM_SESSION_SECRET`) changes.

## Testing
`scripts/verify-*.mjs` (pure checks, API checks against a running server and MySQL) and
`scripts/e2e-browser.mjs` (real Chromium: open, select, save, reload). CI runs all of them.
