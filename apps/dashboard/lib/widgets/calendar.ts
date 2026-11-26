import { buildCalendar, DAYS_SHOWN, type CalendarData, type GoogleEvent } from "../calendar-format";
import { accessToken, GoogleReconnectNeeded, googleConfigured, isConnected } from "../google";
import type { Widget } from "./types";

const API = "https://www.googleapis.com/calendar/v3";
const MAX_CALENDARS = 10;

async function get<T>(token: string, url: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (response.status === 401 || response.status === 403) throw new GoogleReconnectNeeded(`Google refused (${response.status}).`);
  if (!response.ok) throw new Error(`Google Calendar answered ${response.status}.`);
  return (await response.json()) as T;
}

export async function loadEvents(token: string, nowMs: number): Promise<GoogleEvent[]> {
  const list = await get<{ items?: { id: string; summary?: string; selected?: boolean }[] }>(token, `${API}/users/me/calendarList?minAccessRole=reader&fields=items(id,summary,selected)`);
  const calendars = (list.items ?? []).filter((c) => c.selected).slice(0, MAX_CALENDARS);
  const timeMin = new Date(nowMs - 36 * 3600 * 1000).toISOString(); // a little early, so late-evening events in other zones are not missed
  const timeMax = new Date(nowMs + (DAYS_SHOWN + 1) * 24 * 3600 * 1000).toISOString();
  const perCalendar = await Promise.all(
    calendars.map(async (calendar) => {
      const query = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "100", fields: "items(id,summary,status,location,htmlLink,start,end)" });
      const result = await get<{ items?: GoogleEvent[] }>(token, `${API}/calendars/${encodeURIComponent(calendar.id)}/events?${query}`);
      return (result.items ?? []).map((event) => ({ ...event, id: `${calendar.id}:${event.id}`, calendar: calendar.summary }));
    })
  );
  return perCalendar.flat();
}

export const calendarWidget: Widget<CalendarData> = {
  id: "calendar",
  title: "Calendar and heads-up",
  load: async () => {
    if (!googleConfigured()) {
      return { status: "not-connected", setup: "Google is not set up on this server yet. It needs a Google client ID and secret (see docs/DASHBOARD_PLAN.md)." };
    }
    if (!(await isConnected())) {
      return { status: "not-connected", setup: "Connect your Google account to see today's events and what is coming up. Read-only: the dashboard can look but never change anything.", action: { label: "Connect Google Calendar", href: "/api/google/start" } };
    }
    try {
      const nowMs = Date.now();
      const events = await loadEvents(await accessToken(), nowMs);
      return { status: "ready", data: buildCalendar(events, nowMs, process.env.DASHBOARD_TIMEZONE || "America/New_York") };
    } catch (error) {
      if (error instanceof GoogleReconnectNeeded) {
        return { status: "error", message: "Google no longer accepts the saved sign-in. Connect again to continue.", action: { label: "Reconnect Google Calendar", href: "/api/google/start" } };
      }
      return { status: "error", message: "Google Calendar could not be reached just now. It will retry when you reload." };
    }
  }
};
