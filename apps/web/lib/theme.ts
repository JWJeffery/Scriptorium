// Light, dark, or follow the computer. The choice is kept in this browser; <html data-theme> is what the
// stylesheet reads, and data-page="light" keeps scanned PDF pages light even in the dark theme.
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "scriptorium-theme";
export const PAGES_LIGHT_KEY = "scriptorium-pages-light";

// Runs in <head> before the page paints, so there is no flash of the wrong theme.
export const themeInitScript = `try{var d=document.documentElement,t=localStorage.getItem("${THEME_KEY}")||"system",dark=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);d.dataset.theme=dark?"dark":"light";if(localStorage.getItem("${PAGES_LIGHT_KEY}")==="1")d.dataset.page="light"}catch(e){}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage can be blocked; the choice then lasts for this visit only */ }
}

export function readThemeChoice(): ThemeChoice {
  const stored = read(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function readPagesLight(): boolean {
  return read(PAGES_LIGHT_KEY) === "1";
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return choice;
}

export function applyTheme(choice: ThemeChoice, pagesLight: boolean) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(choice);
  if (pagesLight) root.dataset.page = "light"; else delete root.dataset.page;
}

export function saveThemeChoice(choice: ThemeChoice) {
  write(THEME_KEY, choice === "system" ? null : choice);
}

export function savePagesLight(pagesLight: boolean) {
  write(PAGES_LIGHT_KEY, pagesLight ? "1" : null);
}
