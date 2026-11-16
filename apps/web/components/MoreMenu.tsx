"use client";

import { useEffect, useRef, useState } from "react";

export type MoreMenuItem = { key: string; label: string; onSelect: () => void; hidden?: boolean; disabled?: boolean };

// The "⋯" button: the things a reader needs now and then, kept out of the way of reading.
export function MoreMenu({ items, badge }: { items: MoreMenuItem[]; badge?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }
    function onKey(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="themeMenu moreMenu" ref={rootRef}>
      <button type="button" className="themeMenuButton" aria-haspopup="true" aria-expanded={open} aria-label="More" title="More" onClick={() => setOpen((value) => !value)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        {badge ? <span className="moreMenuBadge" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="themeMenuPanel below" role="menu" aria-label="More">
          {items.filter((item) => !item.hidden).map((item) => (
            <button type="button" role="menuitem" key={item.key} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>{item.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
