import type { MetadataRoute } from "next";

// Lets a phone or computer install Scriptorium like an app (Add to Home screen / Install): its own icon, opens
// full screen without the browser's address bar, and updates whenever the site does. No app store, no cost.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scriptorium",
    short_name: "Scriptorium",
    description: "Scholarly reading, annotation and citation.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1b1713",
    theme_color: "#1b1713",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
