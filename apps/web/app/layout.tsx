import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";
import "./pdf-reader.css";
import { themeInitScript } from "../lib/theme";

export const metadata: Metadata = {
  title: "Scriptorium",
  description: "Scholarly reading, annotation, citation, and research-memory platform."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
