# Citation style files

These are unmodified copies of files from the Citation Style Language project:

| File | Source |
|---|---|
| `society-of-biblical-literature-fullnote-bibliography.csl` | https://github.com/citation-style-language/styles |
| `chicago-notes-bibliography.csl` | https://github.com/citation-style-language/styles |
| `apa.csl`, `modern-language-association.csl`, `harvard-cite-them-right.csl` | https://github.com/citation-style-language/styles |
| `locales-en-US.xml` | https://github.com/citation-style-language/locales |

The styles are licensed under Creative Commons Attribution-ShareAlike 3.0
(http://creativecommons.org/licenses/by-sa/3.0/); each file names its authors and
contributors in its `<info>` block. The locale file is CC BY-SA 3.0 as well.

They are run by [citeproc-js](https://github.com/Juris-M/citeproc-js)
(licensed CPAL 1.0 or AGPL 1.0) through `lib/csl-engine.ts`.

To update a style, replace the file with the newer one from the repository above and
run `node --experimental-strip-types scripts/verify-csl-engine.mjs`.

## Things to know

* **Turabian** has no separate file in the official repository. Scriptorium uses the
  Chicago notes style for it, which is the system Turabian's notes-bibliography form follows.
* **SBL (2nd ed.)** deliberately leaves out the place of publication; the style file says
  "place of publication no longer included" and cites the SBLHS2 guidance.
  **Chicago** (17th ed.) does the same for modern books.
