# Page Mapping

## Problem

PDF page numbers are not the same as book page numbers.

A citation requires the book's own page numbering system. A PDF reader requires the PDF's internal page index. Scriptorium must preserve both.

## Required storage

For each page-level location, store:

- zero-based PDF page index,
- visible PDF page label, when available,
- user-confirmed book page label,
- numbering system: arabic, roman, front-matter, unnumbered, plate, appendix, etc.,
- mapping confidence: imported, inferred, user-confirmed, or uncertain.

## v1 behavior

The user should be able to define a simple offset:

> PDF page 19 = book page 1

The app then infers later page labels until another mapping break is defined.

## Later behavior

Support multiple mapping segments:

- front matter in Roman numerals,
- unnumbered title/copyright pages,
- main text in Arabic numerals,
- appendices with prefixed labels,
- scans with missing or duplicated pages.

## Citation rule

Generated citations must use the book page label, not the PDF page index, unless the source truly has no book page label.
