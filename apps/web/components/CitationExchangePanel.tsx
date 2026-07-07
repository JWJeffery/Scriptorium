"use client";

import { useState } from "react";

type CitationExchangeFormat = "csl-json" | "bibtex" | "biblatex";

export type CitationExchangeSourceRecord = {
  author: string;
  title: string;
  place: string;
  publisher: string;
  year: string;
};

type Props = {
  sourceId?: string;
  disabled?: boolean;
  onImportedSource: (source: CitationExchangeSourceRecord) => void;
  onStatusChange: (status: string) => void;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sourceFromCsl(value: unknown): CitationExchangeSourceRecord {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const author = Array.isArray(record.author) ? record.author[0] as Record<string, unknown> | undefined : undefined;
  const issued = typeof record.issued === "object" && record.issued !== null ? record.issued as Record<string, unknown> : {};
  const dateParts = Array.isArray(issued["date-parts"]) ? issued["date-parts"] as unknown[][] : [];
  const firstDatePart = Array.isArray(dateParts[0]) ? dateParts[0][0] : undefined;

  return {
    title: clean(record.title),
    author: clean(author?.literal) || [clean(author?.given), clean(author?.family)].filter(Boolean).join(" "),
    place: clean(record["publisher-place"]),
    publisher: clean(record.publisher),
    year: firstDatePart === undefined || firstDatePart === null ? "" : String(firstDatePart)
  };
}

export function CitationExchangePanel({ sourceId, disabled, onImportedSource, onStatusChange }: Props) {
  const [format, setFormat] = useState<CitationExchangeFormat>("csl-json");
  const [content, setContent] = useState("");

  async function exportSource() {
    if (!sourceId) {
      onStatusChange("Register and persist a source before exporting citation metadata.");
      return;
    }

    const params = new URLSearchParams({ sourceId, format });
    const response = await fetch(`/api/milestone-seven/citation-exchange?${params.toString()}`);
    if (!response.ok) {
      onStatusChange("Citation export failed.");
      return;
    }

    const body = await response.json() as { content: string };
    setContent(body.content);
    onStatusChange(`Exported citation metadata as ${format}.`);
  }

  async function importSource() {
    if (!sourceId) {
      onStatusChange("Register and persist a source before importing citation metadata.");
      return;
    }

    if (!content.trim()) {
      onStatusChange("Paste CSL JSON, BibTeX, or BibLaTeX content before importing.");
      return;
    }

    const response = await fetch("/api/milestone-seven/citation-exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, format, content })
    });

    const body = await response.json() as { cslJson?: unknown; error?: string };
    if (!response.ok || !body.cslJson) {
      onStatusChange(body.error ?? "Citation import failed.");
      return;
    }

    onImportedSource(sourceFromCsl(body.cslJson));
    onStatusChange(`Imported citation metadata from ${format} and updated the source record.`);
  }

  return (
    <div className="citationExchangeBox">
      <h3>Citation import/export</h3>
      <label>Format
        <select value={format} onChange={(event) => setFormat(event.target.value as CitationExchangeFormat)} disabled={disabled}>
          <option value="csl-json">CSL JSON</option>
          <option value="bibtex">BibTeX</option>
          <option value="biblatex">BibLaTeX</option>
        </select>
      </label>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={8} placeholder="Exported or imported citation metadata appears here." disabled={disabled} />
      <div className="citationExchangeActions">
        <button className="secondaryButton" onClick={exportSource} type="button" disabled={disabled}>Export citation</button>
        <button className="secondaryButton" onClick={importSource} type="button" disabled={disabled}>Import citation</button>
      </div>
    </div>
  );
}
