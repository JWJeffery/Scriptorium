import { highlightColors } from "../lib/highlights";

export function HighlightPalette() {
  return (
    <section className="panel" aria-label="Highlight palette">
      <h2>Ten-color palette</h2>
      <div className="palette">
        {highlightColors.map((item) => (
          <div className="swatch" key={item.key}>
            <span className="swatchMark" style={{ background: item.color }} aria-hidden="true" />
            <span>{item.defaultMeaning}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
