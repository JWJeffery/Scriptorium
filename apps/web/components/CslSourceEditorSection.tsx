"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";




import { authorsToText } from "../lib/author-names";
import { type CurrentDocumentRef } from "../lib/tools-shared";

const SOURCE_TYPES = [
  { value: "book", label: "Book" },
  { value: "chapter", label: "Chapter" },
  { value: "article-journal", label: "Journal article" },
  { value: "manuscript", label: "Manuscript" }
];

type SourceEditorFormState = {
  sourceId: string;
  type: string;
  title: string;
  author: string;
  editor: string;
  translator: string;
  containerTitle: string;
  place: string;
  publisher: string;
  volume: string;
  edition: string;
  year: string;
};

const EMPTY_SOURCE_FORM: SourceEditorFormState = {
  sourceId: "",
  type: "book",
  title: "",
  author: "",
  editor: "",
  translator: "",
  containerTitle: "",
  place: "",
  publisher: "",
  volume: "",
  edition: "",
  year: ""
};

type StoredCslRecord = {
  type?: unknown;
  title?: unknown;
  author?: unknown;
  editor?: unknown;
  translator?: unknown;
  "container-title"?: unknown;
  "publisher-place"?: unknown;
  publisher?: unknown;
  volume?: unknown;
  edition?: unknown;
  issued?: unknown;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

// All names, as one line of text ("A. Smith and B. Jones"). Saving parses it back.
function firstCslName(value: unknown) {
  return Array.isArray(value) ? authorsToText(value as Parameters<typeof authorsToText>[0]) : "";
}

function issuedYear(value: unknown) {
  if (typeof value !== "object" || value === null || !("date-parts" in value)) return "";
  const parts = (value as { "date-parts"?: unknown })["date-parts"];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return "";
  const year = parts[0][0];
  return typeof year === "string" || typeof year === "number" ? String(year) : "";
}

function formFromStoredCsl(sourceId: string, value: unknown): SourceEditorFormState {
  const csl = typeof value === "object" && value !== null && !Array.isArray(value) ? value as StoredCslRecord : {};
  return {
    sourceId,
    type: textValue(csl.type) || "book",
    title: textValue(csl.title),
    author: firstCslName(csl.author),
    editor: firstCslName(csl.editor),
    translator: firstCslName(csl.translator),
    containerTitle: textValue(csl["container-title"]),
    place: textValue(csl["publisher-place"]),
    publisher: textValue(csl.publisher),
    volume: textValue(csl.volume),
    edition: textValue(csl.edition),
    year: issuedYear(csl.issued)
  };
}

export function CslSourceEditorSection({ currentRef }: { currentRef: CurrentDocumentRef }) {
  const [form, setForm] = useState<SourceEditorFormState>(EMPTY_SOURCE_FORM);
  const [status, setStatus] = useState("Fill in the fields this source actually needs and save.");
  const [savedShortTitle, setSavedShortTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadSavedMetadata = useCallback(async (sourceId: string) => {
    const cleanSourceId = sourceId.trim();
    if (!cleanSourceId) {
      setStatus("A source id is required before saved metadata can be loaded.");
      return;
    }
    setLoading(true);
    setStatus("Loading saved source metadata...");
    try {
      const response = await fetch(`/api/interchange/citation-exchange?sourceId=${encodeURIComponent(cleanSourceId)}&format=csl-json`);
      const body = (await response.json()) as { cslJson?: unknown; error?: string };
      if (!response.ok || !body.cslJson) {
        setStatus(body.error ?? "Saved source metadata could not be loaded.");
        return;
      }
      setForm(formFromStoredCsl(cleanSourceId, body.cslJson));
      setSavedShortTitle(null);
      setStatus("Loaded the metadata already saved for this source. Add any expanded fields you need, then save.");
    } catch {
      setStatus("Saved source metadata could not be loaded - the server did not respond.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentRef.sourceId) return;
    setForm((previous) => ({ ...previous, sourceId: currentRef.sourceId ?? "" }));
    void loadSavedMetadata(currentRef.sourceId);
  }, [currentRef.sourceId, loadSavedMetadata]);

  function update<K extends keyof SourceEditorFormState>(key: K, value: SourceEditorFormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.sourceId.trim()) {
      setStatus("A source id is required. Register a document above first, or paste a source id below.");
      return;
    }
    setBusy(true);
    setStatus("Saving expanded source record...");
    try {
      const response = await fetch("/api/citations/csl-source-editor", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = (await response.json()) as { source?: { shortTitle?: string }; error?: string };
      if (!response.ok) {
        setStatus(body.error ?? "Save failed.");
        setSavedShortTitle(null);
        return;
      }
      setSavedShortTitle(body.source?.shortTitle ?? form.title);
      setStatus("Saved. This source's CSL record now carries the fuller item shape (editor, translator, container, volume, edition).");
    } catch {
      setStatus("Save failed - the server did not respond.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolsFormLayout">
      <form className="toolsForm" onSubmit={handleSubmit}>
        <label>
          Source id
          <input value={form.sourceId} onChange={(event) => update("sourceId", event.target.value)} placeholder="Filled automatically from the registered document above" />
        </label>
        <label>
          Source type
          <select value={form.type} onChange={(event) => update("type", event.target.value)}>
            {SOURCE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input value={form.title} onChange={(event) => update("title", event.target.value)} />
        </label>
        <div className="twoColumnInputs">
          <label>
            Author
            <input value={form.author} onChange={(event) => update("author", event.target.value)} />
          </label>
          <label>
            Editor
            <input value={form.editor} onChange={(event) => update("editor", event.target.value)} placeholder="For edited volumes" />
          </label>
        </div>
        <div className="twoColumnInputs">
          <label>
            Translator
            <input value={form.translator} onChange={(event) => update("translator", event.target.value)} />
          </label>
          <label>
            Container title
            <input value={form.containerTitle} onChange={(event) => update("containerTitle", event.target.value)} placeholder="Journal or larger work" />
          </label>
        </div>
        <div className="twoColumnInputs">
          <label>
            Place
            <input value={form.place} onChange={(event) => update("place", event.target.value)} />
          </label>
          <label>
            Publisher
            <input value={form.publisher} onChange={(event) => update("publisher", event.target.value)} />
          </label>
        </div>
        <div className="twoColumnInputs">
          <label>
            Volume
            <input value={form.volume} onChange={(event) => update("volume", event.target.value)} />
          </label>
          <label>
            Edition
            <input value={form.edition} onChange={(event) => update("edition", event.target.value)} />
          </label>
        </div>
        <label>
          Year
          <input value={form.year} onChange={(event) => update("year", event.target.value)} />
        </label>
        <div className="toolsResultRowActions">
          <button className="secondaryButton" type="button" disabled={busy || loading || !form.sourceId.trim()} onClick={() => void loadSavedMetadata(form.sourceId)}>
            {loading ? "Loading…" : "Load saved metadata"}
          </button>
          <button className="primaryButton" type="submit" disabled={busy || loading}>
            Save expanded source record
          </button>
        </div>
      </form>
      <div className="toolsSidebarNote">
        <p className="statusLine toolsStatusLine">{status}</p>
        {savedShortTitle ? (
          <div className="generatedCitation">
            <span>Saved short title</span>
            <p>{savedShortTitle}</p>
          </div>
        ) : null}
        <p className="toolsHint">
          The original book-only editor at Milestone 6 is untouched. This form writes to the same Source row but accepts
          chapters, journal articles, and manuscripts, with editor/translator/container/volume/edition fields.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Citation regeneration + staleness
// ---------------------------------------------------------------------------

