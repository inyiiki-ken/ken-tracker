import type { MetadataRoute } from "next";

/**
 * Web App Manifest — makes the site installable on a phone home screen
 * ("Add to Home Screen") so it runs fullscreen like a native app.
 * Next.js serves this at /manifest.webmanifest automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ken Tracker",
    short_name: "Ken Tracker",
    description: "Jewellery / live-sale order tracker",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#151413",
    theme_color: "#151413",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
