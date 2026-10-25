"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A modal dialog: Escape closes it, focus moves into it, and returns to where it came from.
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
    // The dialog is mounted only while open; onClose is stable enough for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="libScrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`libDialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="libDialogHead"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  );
}
