export type HighlightColor = {
  key: string;
  label: string;
  /** What this colour means until the reader renames it. */
  defaultMeaning: string;
  color: string;
  /** A slot the reader names for each book ("Other"). */
  custom?: boolean;
};

// The colours offered when highlighting. Four fixed meanings and two slots the reader names for each book.
export const highlightColors: HighlightColor[] = [
  { key: "yellow", label: "Yellow", defaultMeaning: "Thesis", color: "#fff3a3" },
  { key: "blue", label: "Blue", defaultMeaning: "Secondary argument", color: "#cce5ff" },
  { key: "green", label: "Green", defaultMeaning: "Supporting evidence", color: "#c9f2c7" },
  { key: "orange", label: "Orange", defaultMeaning: "Interesting point", color: "#ffd9a3" },
  { key: "purple", label: "Purple", defaultMeaning: "Other", color: "#e4d3ff", custom: true },
  { key: "teal", label: "Teal", defaultMeaning: "Other", color: "#bfeee9", custom: true }
];

// Colours from the earlier set of ten. No longer offered, but highlights saved with them keep their colour.
export const legacyHighlightColors: HighlightColor[] = [
  { key: "pink", label: "Pink", defaultMeaning: "Historical datum", color: "#ffd1dc" },
  { key: "red", label: "Red", defaultMeaning: "Objection / counterargument", color: "#ffc5c5" },
  { key: "gray", label: "Gray", defaultMeaning: "Citation needed", color: "#dedede" },
  { key: "gold", label: "Gold", defaultMeaning: "Follow-up question", color: "#f5d46b" }
];

export const allHighlightColors: HighlightColor[] = [...highlightColors, ...legacyHighlightColors];

/** The names a reader has given the custom colours of one book. */
export type HighlightLegend = Record<string, string>;

export const MAX_LEGEND_LABEL = 40;

export function findHighlightColor(key: string | undefined | null): HighlightColor {
  return allHighlightColors.find((color) => color.key === key) ?? highlightColors[0];
}

export function meaningFor(key: string | undefined | null, legend?: HighlightLegend | null): string {
  const color = findHighlightColor(key);
  const named = color.custom ? legend?.[color.key]?.trim() : "";
  return named || color.defaultMeaning;
}

export function parseLegend(text: string | null | undefined): HighlightLegend {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const legend: HighlightLegend = {};
    for (const color of highlightColors) {
      const value = (raw as Record<string, unknown>)[color.key];
      if (color.custom && typeof value === "string" && value.trim()) legend[color.key] = value.trim().slice(0, MAX_LEGEND_LABEL);
    }
    return legend;
  } catch {
    return {};
  }
}
