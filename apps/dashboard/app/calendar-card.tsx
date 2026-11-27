"use client";

import type { CalendarData, CalEvent } from "../lib/calendar-format";

function Event({ event }: { event: CalEvent }) {
  return (
    <li className={event.past ? "event past" : "event"}>
      <span className="when">{event.timeLabel}</span>
      <span className="what">
        {event.link ? <a href={event.link} target="_blank" rel="noopener noreferrer">{event.title}</a> : event.title}
        {event.location ? <span className="where"> · {event.location}</span> : null}
      </span>
    </li>
  );
}

export default function CalendarCard({ data }: { data: CalendarData }) {
  return (
    <>
      <span className="badge ready">connected</span>
      {data.headsUp.length ? (
        <div className="headsup" role="note">
          <strong>Coming up in the next 24 hours</strong>
          <ul className="events">{data.headsUp.map((event) => <Event key={`h-${event.id}`} event={event} />)}</ul>
        </div>
      ) : null}
      {data.days.map((day) => (
        <div key={day.date} className="day">
          <h3>{day.label}</h3>
          {day.events.length ? <ul className="events">{day.events.map((event) => <Event key={`${day.date}-${event.id}`} event={event} />)}</ul> : <p className="muted">Nothing scheduled.</p>}
        </div>
      ))}
      <p>
        <button
          className="link"
          onClick={async () => {
            await fetch("/api/google/disconnect", { method: "POST" });
            window.location.href = "/";
          }}
        >
          Disconnect Google
        </button>
      </p>
    </>
  );
}
