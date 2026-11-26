import { calendarWidget } from "./calendar";
import type { Widget, WidgetResult } from "./types";

// First slice: the Today view. Each source below starts as "not connected" and is
// replaced by a real connector one at a time (see docs/DASHBOARD_PLAN.md).

const notConnected = (setup: string) => async (): Promise<WidgetResult<never>> => ({ status: "not-connected", setup });

export const emailWidget: Widget<never> = {
  id: "email",
  title: "Important email",
  load: notConnected("Connect Gmail and Spacemail (jwjeffery.org) to surface the messages that matter.")
};

export const liturgyWidget: Widget<never> = {
  id: "liturgy",
  title: "Today in the Daily Office",
  load: notConnected("Needs a source for 1979 Book of Common Prayer lectionary readings. Nothing from other lectionaries will be used.")
};

export const tasksWidget: Widget<never> = {
  id: "tasks",
  title: "To-do and reminders",
  load: notConnected("A task store that Claude and ChatGPT can both read and write through an MCP connector.")
};

export const scriptoriumWidget: Widget<{ url: string }> = {
  id: "scriptorium",
  title: "Scriptorium",
  load: async () => {
    const url = process.env.DASHBOARD_SCRIPTORIUM_URL?.trim();
    if (!url) return { status: "not-connected", setup: "Set DASHBOARD_SCRIPTORIUM_URL to the address of your Scriptorium." };
    return { status: "ready", data: { url } };
  }
};

export { calendarWidget };
export const todayWidgets = [calendarWidget, emailWidget, liturgyWidget, tasksWidget, scriptoriumWidget] as const;
