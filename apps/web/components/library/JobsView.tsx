"use client";

import { useCallback, useEffect, useState } from "react";
import { AppNav } from "./AppNav";
import { JOB_LABEL, api, dateLabel, type JobSummary } from "../../lib/library-client";

const STATE_TEXT: Record<JobSummary["state"], string> = { queued: "Waiting", running: "Running", complete: "Done", failed: "Failed" };

export function JobsView() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "failed">("all");

  const load = useCallback(async () => {
    try {
      const query = filter === "failed" ? "&state=failed" : "";
      setJobs((await api<{ jobs: JobSummary[] }>(`/api/v1/jobs?limit=50${query}`)).jobs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The jobs could not be loaded.");
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  const busy = jobs?.some((job) => job.state === "queued" || job.state === "running");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  async function retry(job: JobSummary) {
    try { await api(`/api/v1/jobs/${job.id}/retry`, { method: "POST" }); setMessage("Queued again."); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "It could not be retried."); }
  }

  const shown = (jobs ?? []).filter((job) => filter !== "active" || job.state === "queued" || job.state === "running");

  return (
    <div className="libPage">
      <AppNav current="jobs" />
      <main className="libDetail">
        <div className="libHeading"><h1>Background jobs</h1><span className="libCount" aria-live="polite">{busy ? "Working…" : "Idle"}</span></div>
        <p className="libFaint">Reading scanned pages, splitting spreads and building the by-meaning index run here, one at a time. A job that fails is tried once more automatically.</p>
        <div className="libToolbar">
          {(["all", "active", "failed"] as const).map((entry) => <button key={entry} type="button" aria-pressed={filter === entry} onClick={() => setFilter(entry)}>{entry === "all" ? "All" : entry === "active" ? "Waiting or running" : "Failed"}</button>)}
        </div>
        {message ? <p className="libMessage" role="status">{message}</p> : null}
        {jobs === null ? <p className="libFaint">Loading…</p> : shown.length === 0 ? <p className="libEmpty">{filter === "failed" ? "Nothing has failed." : filter === "active" ? "Nothing is waiting or running." : "No background jobs yet."}</p> : (
          <table className="libTable compact">
            <thead><tr><th scope="col">Job</th><th scope="col">Book</th><th scope="col">State</th><th scope="col">Progress</th><th scope="col">Started</th><th scope="col"><span className="srOnly">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((job) => (
                <tr key={job.id}>
                  <td data-label="Job">{JOB_LABEL[job.type] ?? job.type}</td>
                  <td data-label="Book">{job.itemId ? <a href={`/items/${job.itemId}`}>{job.itemTitle ?? job.itemId}</a> : <span className="libFaint">unknown</span>}</td>
                  <td data-label="State"><span className={`libState ${job.state}`}>{STATE_TEXT[job.state]}</span>{job.error ? <small className="libBad">{job.error}</small> : null}{job.attempts > 1 ? <small className="libFaint">attempt {job.attempts}</small> : null}</td>
                  <td data-label="Progress">{job.progress ? <span className="libProgress"><progress max={job.progress.total} value={job.progress.done} aria-label="Progress" /><span>{job.progress.done}/{job.progress.total}</span></span> : <span className="libFaint">—</span>}</td>
                  <td data-label="Started">{dateLabel(job.createdAt)}</td>
                  <td data-label="Actions">{job.state === "failed" ? <button type="button" onClick={() => void retry(job)}>Try again</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
