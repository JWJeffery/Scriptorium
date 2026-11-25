import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "Dashboard", description: "Personal dashboard for jwjeffery.org" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
