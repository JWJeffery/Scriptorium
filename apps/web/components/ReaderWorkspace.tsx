export function ReaderWorkspace() {
  return (
    <section className="reader" aria-label="Reader workspace">
      <div className="readerToolbar">
        <div>
          <strong>Lumen Gentium</strong>
          <div>PDF page 19 · Book page 1</div>
        </div>
        <div>Selected style: SBL notes</div>
      </div>
      <article className="pageCanvas">
        <p>
          This is the reading surface placeholder. The v1 implementation replaces this
          placeholder with a PDF.js-powered document viewer while preserving a separate
          scholarly overlay for highlights, notes, page mappings, and citations.
        </p>
        <p>
          The essential data structure is already visible here: the app knows both the
          PDF page and the book page. A saved annotation must attach to the internal
          page location but cite the book page.
        </p>
        <p>
          Example selected passage: <span className="annotationCallout">the church is in Christ like a sacrament or as a sign and instrument</span>.
          The citation panel should generate a footnote from the linked source record,
          not from unstructured text.
        </p>
      </article>
    </section>
  );
}
