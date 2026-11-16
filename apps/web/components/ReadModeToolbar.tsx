"use client";

import type { HighlightColor, HighlightLegend } from "../lib/highlights";
import { HighlightMeaning, swatchName } from "./HighlightMeaning";

// The small toolbar down the left edge of read mode. The highlighter button opens a floating palette
// of the highlight meanings; while it is on, selecting text saves a highlight straight away.
export function ReadModeToolbar({
  colors,
  legend,
  onRename,
  selectedColor,
  highlighterOn,
  onSelectColor,
  onToggleHighlighter,
  onSearch,
  onExit
}: {
  colors: HighlightColor[];
  legend: HighlightLegend;
  onRename: (key: string, label: string) => void;
  selectedColor: string;
  highlighterOn: boolean;
  onSelectColor: (key: string) => void;
  onToggleHighlighter: () => void;
  onSearch: () => void;
  onExit: () => void;
}) {
  const active = colors.find((color) => color.key === selectedColor) ?? colors[0];
  return (
    <nav className="readRail" aria-label="Read mode tools">
      <button type="button" className="readRailButton" onClick={onExit} title="Exit read mode (Esc)" aria-label="Exit read mode">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      <div className="readRailGroup">
        <button
          type="button"
          className={`readRailButton${highlighterOn ? " active" : ""}`}
          onClick={onToggleHighlighter}
          aria-pressed={highlighterOn}
          aria-label="Highlighter"
          title={highlighterOn ? "Highlighter on: select text to highlight it (h)" : "Highlighter (h)"}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 20h7M14.5 4.5l5 5-8.5 8.5H6v-5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <span className="readRailSwatch" style={{ background: active.color }} aria-hidden="true" />
        </button>
        {highlighterOn ? (
          <div className="readPalette" role="toolbar" aria-label="Highlighter">
            <div className="readPaletteSwatches" role="group" aria-label="Highlight meaning">
              {colors.map((color) => (
                <button
                  type="button"
                  key={color.key}
                  className={`readPaletteSwatch${color.key === selectedColor ? " active" : ""}`}
                  style={{ background: color.color }}
                  aria-label={swatchName(color.key, legend)}
                  aria-pressed={color.key === selectedColor}
                  title={swatchName(color.key, legend)}
                  onClick={() => onSelectColor(color.key)}
                />
              ))}
            </div>
            <HighlightMeaning className="readPaletteMeaning" colorKey={active.key} legend={legend} onRename={onRename} />
            <button type="button" className="readPaletteDone" onClick={onToggleHighlighter}>Done</button>
          </div>
        ) : null}
      </div>
      <button type="button" className="readRailButton" onClick={onSearch} title="Search (Ctrl+K or /)" aria-label="Search">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
    </nav>
  );
}
