import { todayWidgets } from "../lib/widgets/registry";
import type { WidgetResult } from "../lib/widgets/types";
import LogoutButton from "./logout-button";

export const dynamic = "force-dynamic";

async function loadSafely(load: () => Promise<WidgetResult<unknown>>): Promise<WidgetResult<unknown>> {
  try {
    return await load();
  } catch {
    return { status: "error", message: "This source could not be loaded." };
  }
}

export default async function TodayPage() {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: process.env.DASHBOARD_TIMEZONE || "America/New_York" });
  const results = await Promise.all(todayWidgets.map(async (widget) => ({ widget, result: await loadSafely(widget.load) })));

  return (
    <main>
      <header className="top">
        <div>
          <h1>Today</h1>
          <div className="date">{today}</div>
        </div>
        <LogoutButton />
      </header>
      <div className="grid">
        {results.map(({ widget, result }) => (
          <section className="card" key={widget.id}>
            <h2>{widget.title}</h2>
            {result.status === "ready" && widget.id === "scriptorium" ? (
              <>
                <span className="badge ready">connected</span>
                <p><a className="button" href={(result.data as { url: string }).url}>Open Scriptorium</a></p>
              </>
            ) : result.status === "not-connected" ? (
              <>
                <span className="badge">not connected</span>
                <p className="muted">{result.setup}</p>
              </>
            ) : result.status === "error" ? (
              <>
                <span className="badge">problem</span>
                <p className="muted">{result.message}</p>
              </>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  );
}
