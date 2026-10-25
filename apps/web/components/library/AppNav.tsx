import type { ReactNode } from "react";

// The strip across the top of the Library, Inbox, Jobs and item pages. (The reader has its own top bar.)
const LINKS = [
  { key: "inbox", href: "/inbox", label: "Inbox" },
  { key: "library", href: "/library", label: "Library" },
  { key: "reader", href: "/", label: "Reader" },
  { key: "jobs", href: "/jobs", label: "Jobs" }
];

export function AppNav({ current, children }: { current: "inbox" | "library" | "reader" | "jobs"; children?: ReactNode }) {
  return (
    <header className="libNav">
      <strong className="libBrand">Scriptorium</strong>
      <nav aria-label="Main">
        {LINKS.map((link) => (
          <a key={link.key} href={link.href} aria-current={link.key === current ? "page" : undefined}>{link.label}</a>
        ))}
      </nav>
      <div className="libNavExtra">{children}</div>
    </header>
  );
}
