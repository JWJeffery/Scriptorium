"use client";

import { useEffect, useState } from "react";
import { NUMBERING_SYSTEMS, labelForPage, validateRanges, type NumberingSystem, type PageRangeSpec } from "../lib/page-labels";

type Row = { startPdfPage: string; endPdfPage: string; system: NumberingSystem; startValue: string; prefix: string };

function toRows(ranges: PageRangeSpec[]): Row[] {
  return ranges.map((range) => ({ startPdfPage: String(range.startPdfPage), endPdfPage: range.endPdfPage === null ? "" : String(range.endPdfPage), system: range.system, startValue: String(range.startValue), prefix: range.prefix }));
}

function fromRows(rows: Row[]): PageRangeSpec[] {
  return rows.map((row) => ({
    startPdfPage: Number(row.startPdfPage),
    endPdfPage: row.endPdfPage.trim() === "" ? null : Number(row.endPdfPage),
    system: row.system,
    startValue: row.system === "unnumbered" ? 1 : Number(row.startValue),
    prefix: row.system === "arabic" ? row.prefix : ""
  }));
}

type Props = {
  ranges: PageRangeSpec[];
  saved: boolean; // false = the numbering is still the document's original single rule
  currentPage: number;
  pageCount: number;
  disabled?: boolean;
  onSave: (ranges: PageRangeSpec[]) => Promise<string>;
};

/** Edit how PDF pages map to printed page numbers: Roman preface, body, appendix, unnumbered pages. */
export function PageNumberingEditor({ ranges, saved, currentPage, pageCount, disabled, onSave }: Props) {
  const [rows, setRows] = useState<Row[]>(() => toRows(ranges));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRows(toRows(ranges)); }, [ranges]);

  const draft = fromRows(rows);
  const problem = rows.some((row) => !/^\d+$/.test(row.startPdfPage) || (row.endPdfPage.trim() !== "" && !/^\d+$/.test(row.endPdfPage)) || (row.system !== "unnumbered" && !/^\d+$/.test(row.startValue)))
    ? "Fill in the page numbers with whole numbers."
    : validateRanges(draft);

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setMessage("");
  }

  function addRange() {
    const last = rows[rows.length - 1];
    const lastEnd = last ? (last.endPdfPage.trim() === "" ? currentPage : Number(last.endPdfPage)) : 0;
    setRows((current) => {
      const closed = current.map((row, i) => (i === current.length - 1 && row.endPdfPage.trim() === "" ? { ...row, endPdfPage: String(Math.max(Number(row.startPdfPage), currentPage - 1)) } : row));
      return [...closed, { startPdfPage: String(Math.max(currentPage, lastEnd + 1)), endPdfPage: "", system: "arabic", startValue: "1", prefix: "" }];
    });
    setMessage("");
  }

  async function save() {
    if (problem) { setMessage(problem); return; }
    setBusy(true);
    try { setMessage(await onSave(draft)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the numbering."); }
    finally { setBusy(false); }
  }

  const preview = problem ? null : labelForPage(draft, currentPage);

  return (
    <div className="pageNumbering">
      <p className="pageNumberingHelp">
        Tell Scriptorium how the book is numbered. Add a range for each stretch: for example the Roman-numeral preface, then the body from page 1.
        {saved ? "" : " (This is still the single rule the document was registered with.)"}
      </p>
      {rows.map((row, index) => (
        <div className="rangeRow" key={index}>
          <label>From PDF page<input inputMode="numeric" value={row.startPdfPage} onChange={(event) => update(index, { startPdfPage: event.target.value })} disabled={disabled} /></label>
          <label>to<input inputMode="numeric" value={row.endPdfPage} placeholder={index === rows.length - 1 ? `end (${pageCount || "last"})` : ""} onChange={(event) => update(index, { endPdfPage: event.target.value })} disabled={disabled} /></label>
          <label>Printed as
            <select value={row.system} onChange={(event) => update(index, { system: event.target.value as NumberingSystem })} disabled={disabled}>
              {NUMBERING_SYSTEMS.map((system) => <option key={system.value} value={system.value}>{system.label}</option>)}
            </select>
          </label>
          {row.system !== "unnumbered" ? <label>Starting at<input inputMode="numeric" value={row.startValue} onChange={(event) => update(index, { startValue: event.target.value })} disabled={disabled} /></label> : null}
          {row.system === "arabic" ? <label>Prefix<input value={row.prefix} maxLength={16} placeholder="e.g. A-" onChange={(event) => update(index, { prefix: event.target.value })} disabled={disabled} /></label> : null}
          <button type="button" className="textAction dangerAction" onClick={() => { setRows((current) => current.filter((_, i) => i !== index)); setMessage(""); }} disabled={disabled || rows.length === 1} aria-label="Remove this range">Remove</button>
        </div>
      ))}
      <div className="pageNumberingActions">
        <button type="button" className="textAction" onClick={addRange} disabled={disabled}>+ Add a range</button>
        <button type="button" className="secondaryButton" onClick={() => void save()} disabled={disabled || busy || Boolean(problem)}>{busy ? "Saving…" : "Save numbering"}</button>
      </div>
      {problem ? <p className="pageNumberingProblem" role="alert">{problem}</p> : <p className="pageNumberingPreview">PDF page {currentPage} will be cited as {preview ? `page ${preview}` : "an unnumbered page (the citation will leave out the page)"}.</p>}
      {message ? <p className="inlineSaveNotice">{message}</p> : null}
    </div>
  );
}
