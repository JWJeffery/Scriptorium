export type HighlightColor = {
  key: string;
  label: string;
  defaultMeaning: string;
  color: string;
};

export const highlightColors: HighlightColor[] = [
  { key: "yellow", label: "Yellow", defaultMeaning: "Thesis-relevant", color: "#fff3a3" },
  { key: "green", label: "Green", defaultMeaning: "Primary claim", color: "#c9f2c7" },
  { key: "blue", label: "Blue", defaultMeaning: "Methodological point", color: "#cce5ff" },
  { key: "pink", label: "Pink", defaultMeaning: "Historical datum", color: "#ffd1dc" },
  { key: "orange", label: "Orange", defaultMeaning: "Primary source quotation", color: "#ffd9a3" },
  { key: "purple", label: "Purple", defaultMeaning: "Patristic / classical source", color: "#e4d3ff" },
  { key: "teal", label: "Teal", defaultMeaning: "Ecclesiology", color: "#bfeee9" },
  { key: "red", label: "Red", defaultMeaning: "Objection / counterargument", color: "#ffc5c5" },
  { key: "gray", label: "Gray", defaultMeaning: "Citation needed", color: "#dedede" },
  { key: "gold", label: "Gold", defaultMeaning: "Follow-up question", color: "#f5d46b" }
];
