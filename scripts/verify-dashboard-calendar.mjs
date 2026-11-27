// Checks the dashboard's calendar grouping against known events and a fixed clock.
//   node --experimental-strip-types scripts/verify-dashboard-calendar.mjs
import assert from "node:assert/strict";
import { buildCalendar, dayKey } from "../apps/dashboard/lib/calendar-format.ts";

const tz = "America/New_York";
// Thursday 26 Nov 2026, 10:00 in New York (15:00 UTC).
const now = Date.parse("2026-11-26T15:00:00Z");

assert.equal(dayKey(Date.parse("2026-11-27T03:30:00Z"), tz), "2026-11-26", "late evening New York is still the 26th there, though already the 27th in UTC");

const events = [
  { id: "a", summary: "Morning prayer", start: { dateTime: "2026-11-26T13:00:00Z" }, end: { dateTime: "2026-11-26T13:30:00Z" } },   // 8:00 today, already over
  { id: "b", summary: "Dentist", start: { dateTime: "2026-11-26T19:30:00Z" }, end: { dateTime: "2026-11-26T20:30:00Z" }, location: "Main St" }, // 2:30 PM today, soon
  { id: "c", summary: "Thanksgiving week", start: { date: "2026-11-26" }, end: { date: "2026-11-29" } }, // all-day, covers 26, 27, 28
  { id: "d", summary: "Vestry meeting", start: { dateTime: "2026-11-27T22:00:00Z" }, end: { dateTime: "2026-11-27T23:00:00Z" } },    // tomorrow 5 PM: inside 24h? 31h away, no
  { id: "e", summary: "Call tomorrow", start: { dateTime: "2026-11-27T14:00:00Z" }, end: { dateTime: "2026-11-27T14:30:00Z" } },     // tomorrow 9 AM, 23h away: heads-up
  { id: "f", summary: "Cancelled thing", status: "cancelled", start: { dateTime: "2026-11-26T20:00:00Z" } },
  { id: "g", summary: "Next month", start: { dateTime: "2026-12-30T15:00:00Z" } },                                                  // outside the 7 days
  { id: "h", summary: "", start: { dateTime: "2026-11-29T15:00:00Z" }, end: { dateTime: "2026-11-29T16:00:00Z" } }                  // untitled, 3 days out
];

const { days, headsUp } = buildCalendar(events, now, tz);

assert.deepEqual(days.map((d) => d.label), ["Today", "Tomorrow", "Saturday, November 28", "Sunday, November 29"], "empty later days are left out; today always shows");
const today = days[0].events;
assert.deepEqual(today.map((e) => e.id), ["c", "a", "b"], "all-day first, then by time; the cancelled event is gone");
assert.equal(today.find((e) => e.id === "a").past, true, "an event that has ended is marked past");
assert.equal(today.find((e) => e.id === "b").past, false);
assert.equal(today.find((e) => e.id === "b").timeLabel, "2:30 PM", "times are shown in the owner's time zone");
assert.equal(today.find((e) => e.id === "c").timeLabel, "All day");
assert.deepEqual(days[1].events.map((e) => e.id), ["c", "e", "d"], "a multi-day all-day event appears on each day it covers");
assert.deepEqual(days[2].events.map((e) => e.id), ["c"]);
assert.equal(days[3].events[0].title, "(No title)");
assert.ok(!days.flatMap((d) => d.events).some((e) => e.id === "g"), "events beyond 7 days are not shown");
assert.deepEqual(headsUp.map((e) => e.id), ["b", "e"], "heads-up = timed events starting in the next 24 hours, soonest first");

// An empty calendar still shows today.
assert.deepEqual(buildCalendar([], now, tz).days.map((d) => [d.label, d.events.length]), [["Today", 0]]);

// Daylight-saving change (clocks go back 1 Nov 2026) must not skip or repeat a day.
const dst = buildCalendar([{ id: "x", summary: "x", start: { dateTime: "2026-11-02T15:00:00Z" } }], Date.parse("2026-10-31T15:00:00Z"), tz);
assert.deepEqual(dst.days.map((d) => d.date), ["2026-10-31", "2026-11-02"]);

console.log("Dashboard calendar verified: day grouping in the owner's time zone, all-day and multi-day events, cancelled and out-of-range events dropped, heads-up window, daylight-saving change.");
