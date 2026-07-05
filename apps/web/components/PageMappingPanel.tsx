export function PageMappingPanel() {
  return (
    <section className="panel" aria-label="Page mapping">
      <h2>Page mapping</h2>
      <p>Store both PDF location and scholarly book-page locator.</p>
      <div className="metaGrid">
        <div className="metaBox">
          <span>PDF page index</span>
          <strong>18</strong>
        </div>
        <div className="metaBox">
          <span>Book page</span>
          <strong>1</strong>
        </div>
        <div className="metaBox">
          <span>Visible label</span>
          <strong>19</strong>
        </div>
        <div className="metaBox">
          <span>Confidence</span>
          <strong>User confirmed</strong>
        </div>
      </div>
    </section>
  );
}
