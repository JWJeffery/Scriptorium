// Turns the raw events Google returns into what the Today page shows: events grouped by
// day, in the owner's time zone, plus a short "heads-up" list of what starts soon.
// Pure functions only (no network, no clock of their own), so they can be tested exactly.
// Keep this file to erasable TypeScript (no enums) so the test script can run it directly.

export type GoogleEvent = {
  id?: string;
  summary?: string;
  status?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  calendar?: string;
};

export type CalEvent = {
  id: string;
  title: string;
  allDay: boolean;
  timeLabel: string; // "All day" or "2:30 PM"
  past: boolean;
  location?: string;
  link?: string;
  calendar?: string;
  startMs: number;
};

export type DayGroup = { date: string; label: string; events: CalEvent[] };
export type CalendarData = { days: DayGroup[]; headsUp: CalEvent[] };

export const DAYS_SHOWN = 7;
export const HEADS_UP_HOURS = 24;

/** "2026-11-26" for an instant, as the calendar date in that time zone. */
export function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === addDaysToKey(todayKey, 1)) return "Tomorrow";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function timeLabel(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

/** Calendar dates an all-day event covers. Google's end date is exclusive. */
function allDayKeys(startDate: string, endDate: string | undefined): string[] {
  const keys: string[] = [];
  const last = endDate && endDate > startDate ? addDaysToKey(endDate, -1) : startDate;
  for (let key = startDate; key <= last && keys.length < 60; key = addDaysToKey(key, 1)) keys.push(key);
  return keys;
}

export function buildCalendar(events: GoogleEvent[], nowMs: number, timeZone: string): CalendarData {
  const todayKey = dayKey(nowMs, timeZone);
  const lastKey = addDaysToKey(todayKey, DAYS_SHOWN - 1);
  const byDay = new Map<string, CalEvent[]>();

  const add = (key: string, event: CalEvent) => {
    if (key < todayKey || key > lastKey) return;
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  };

  for (const raw of events) {
    if (raw.status === "cancelled") continue;
    const title = raw.summary?.trim() || "(No title)";
    const base = { id: raw.id ?? `${title}-${raw.start?.dateTime ?? raw.start?.date}`, title, location: raw.location, link: raw.htmlLink, calendar: raw.calendar };
    if (raw.start?.date && !raw.start.dateTime) {
      const event: CalEvent = { ...base, allDay: true, timeLabel: "All day", past: false, startMs: Date.parse(`${raw.start.date}T00:00:00Z`) };
      for (const key of allDayKeys(raw.start.date, raw.end?.date)) add(key, event);
    } else if (raw.start?.dateTime) {
      const startMs = Date.parse(raw.start.dateTime);
      if (Number.isNaN(startMs)) continue;
      const endMs = raw.end?.dateTime ? Date.parse(raw.end.dateTime) : startMs;
      add(dayKey(startMs, timeZone), { ...base, allDay: false, timeLabel: timeLabel(startMs, timeZone), past: endMs < nowMs, startMs });
    }
  }

  const days: DayGroup[] = [];
  for (let i = 0; i < DAYS_SHOWN; i += 1) {
    const key = addDaysToKey(todayKey, i);
    const list = byDay.get(key) ?? [];
    if (i > 0 && list.length === 0) continue; // today always shows (even when empty); empty later days are left out
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs || a.title.localeCompare(b.title));
    days.push({ date: key, label: dayLabel(key, todayKey), events: list });
  }

  // Heads-up: timed events starting within the next day, soonest first (de-duplicated by id).
  const horizon = nowMs + HEADS_UP_HOURS * 3600 * 1000;
  const seen = new Set<string>();
  const headsUp = days
    .flatMap((day) => day.events)
    .filter((event) => !event.allDay && event.startMs > nowMs && event.startMs <= horizon)
    .sort((a, b) => a.startMs - b.startMs)
    .filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)));

  return { days, headsUp };
}
