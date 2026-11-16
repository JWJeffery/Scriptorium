"use client";

import type { HighlightColor, HighlightLegend } from "../lib/highlights";
import { swatchName } from "./HighlightMeaning";

// The small card in read mode for keeping a highlight with a comment.
//  - "pending": text is selected with the highlighter off. Nothing is kept until Save.
//  - "saved":   the highlighter has just saved a highlight; a comment can be added to it.
export function ReadNoteCard({
  mode,
  excerpt,
  colors,
  legend,
  selectedColor,
  onSelectColor,
  note,
  onNoteChange,
  onPrimary,
  onSecondary
}: {
  mode: "pending" | "saved";
  excerpt: string;
  colors: HighlightColor[];
  legend: HighlightLegend;
  selectedColor: string;
  onSelectColor: (key: string) => void;
  note: string;
  onNoteChange: (value: string) => void;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  const pending = mode === "pending";
  return (
    <div className="readNoteCard" role="dialog" aria-label={pending ? "Save this highlight" : "Add a comment to this highlight"}>
      <p className="readNoteTitle">{pending ? "Save this highlight" : "Highlight saved"}</p>
      {excerpt ? <blockquote className="readNoteExcerpt">{excerpt}</blockquote> : null}
      {pending ? (
        <div className="readNoteSwatches" role="group" aria-label="Highlight meaning">
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
      ) : null}
      <textarea
        className="readNoteInput"
        value={note}
        rows={3}
        placeholder={pending ? "Add a comment (optional)" : "Add a comment"}
        aria-label="Comment"
        onChange={(event) => onNoteChange(event.target.value)}
        onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onPrimary(); } }}
      />
      <div className="readNoteActions">
        <button type="button" className="readNoteSecondary" onClick={onSecondary}>{pending ? "Discard" : "Done"}</button>
        {pending || note.trim() ? <button type="button" className="readNotePrimary" onClick={onPrimary}>{pending ? "Save" : "Save comment"}</button> : null}
      </div>
    </div>
  );
}
