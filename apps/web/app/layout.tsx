import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import "./pdf-reader.css";
import { themeInitScript } from "../lib/theme";
import { BackupWarning } from "../components/BackupWarning";

export const metadata: Metadata = {
  title: "Scriptorium",
  description: "Scholarly reading, annotation, citation, and research-memory platform.",
  // Installable as an app (app/manifest.ts); on iPhone/iPad "Add to Home Screen" uses these.
  appleWebApp: { capable: true, title: "Scriptorium", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" }
};

export const viewport: Viewport = {
  themeColor: "#1b1713",
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body><BackupWarning />{children}</body>
    </html>
  );
}
