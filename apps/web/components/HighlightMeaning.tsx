"use client";

import { useEffect, useState } from "react";

import { MAX_LEGEND_LABEL, findHighlightColor, meaningFor, type HighlightLegend } from "../lib/highlights";

// What the chosen highlight colour means. The two "Other" colours can be named for the book being read:
// they show as a box to type in, and the name is kept with the book.
export function HighlightMeaning({ colorKey, legend, onRename, className }: { colorKey: string; legend: HighlightLegend; onRename?: (key: string, label: string) => void; className?: string }) {
  const color = findHighlightColor(colorKey);
  const saved = legend[color.key] ?? "";
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved, color.key]);

  if (!color.custom || !onRename) return <p className={className}>{meaningFor(colorKey, legend)}</p>;

  function commit() {
    const next = draft.trim();
    if (next !== saved) onRename?.(color.key, next);
  }

  return (
    <input
      className={`meaningInput${className ? ` ${className}` : ""}`}
      value={draft}
      maxLength={MAX_LEGEND_LABEL}
      placeholder="Name this colour (for this book)"
      aria-label="Name for this highlight colour"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); (event.currentTarget as HTMLInputElement).blur(); } }}
    />
  );
}

/** Spoken name for a colour swatch: the meaning, with the colour added while two slots are both just "Other". */
export function swatchName(colorKey: string, legend: HighlightLegend) {
  const color = findHighlightColor(colorKey);
  return color.custom && !legend[color.key] ? `${meaningFor(colorKey, legend)} (${color.label.toLowerCase()})` : meaningFor(colorKey, legend);
}
