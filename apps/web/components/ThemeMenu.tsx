"use client";

import { useEffect, useRef, useState } from "react";

import { applyTheme, readPagesLight, readThemeChoice, resolveTheme, savePagesLight, saveThemeChoice, type ThemeChoice } from "../lib/theme";

const CHOICES: Array<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "Match my computer" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];

// A small button that opens the choice of Light, Dark or Match my computer, and whether scanned PDF pages go dark too.
export function ThemeMenu({ placement = "below", className }: { placement?: "below" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [pagesLight, setPagesLight] = useState(false);
  const [dark, setDark] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = readThemeChoice();
    setChoice(stored);
    setPagesLight(readPagesLight());
    setDark(resolveTheme(stored) === "dark");
  }, []);

  // While "Match my computer" is chosen, follow the computer when it switches.
  useEffect(() => {
    if (choice !== "system") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => { applyTheme("system", pagesLight); setDark(query.matches); };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice, pagesLight]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function choose(next: ThemeChoice) {
    setChoice(next);
    saveThemeChoice(next);
    applyTheme(next, pagesLight);
    setDark(resolveTheme(next) === "dark");
  }

  function togglePages(next: boolean) {
    setPagesLight(next);
    savePagesLight(next);
    applyTheme(choice, next);
  }

  return (
    <div className={`themeMenu${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button type="button" className="themeMenuButton" aria-haspopup="true" aria-expanded={open} aria-label="Appearance" title="Appearance: light or dark" onClick={() => setOpen((value) => !value)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {dark
            ? <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
            : <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>}
        </svg>
      </button>
      {open ? (
        <div className={`themeMenuPanel ${placement}`} role="menu" aria-label="Appearance">
          {CHOICES.map((item) => (
            <button type="button" role="menuitemradio" aria-checked={choice === item.value} key={item.value} className={choice === item.value ? "active" : undefined} onClick={() => choose(item.value)}>{item.label}</button>
          ))}
          <label className="themeMenuCheck">
            <input type="checkbox" checked={!pagesLight} onChange={(event) => togglePages(!event.target.checked)} />
            <span>Dark PDF pages</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
