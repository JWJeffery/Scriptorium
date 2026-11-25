// Every card on the dashboard is a "widget" with one job: report one source's state.
// A widget is either ready (with data), not connected yet (with the setup step that
// is missing), or failing (with a short reason). One broken source never takes down
// the page, because each widget is loaded on its own.

export type WidgetResult<T> =
  | { status: "ready"; data: T }
  | { status: "not-connected"; setup: string }
  | { status: "error"; message: string };

export type Widget<T> = {
  id: string;
  title: string;
  load: () => Promise<WidgetResult<T>>;
};
