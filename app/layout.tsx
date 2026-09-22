import type { Metadata, Viewport } from "next";
import { Cinzel, Lato } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { BRAND } from "@/config/brand";
import PWARegister from "@/components/PWARegister";
import "./globals.css";

// Matches the @import in the compiled CSS bundle exactly:
// Cinzel:wght@400;500;600;700;800;900 & Lato:ital,wght@0,300;0,400;0,700;1,400
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-cinzel",
  display: "swap",
});

const lato = Lato({
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
  variable: "--font-lato",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND.pageTitle,
  description: "Internal CRM, order tracker, and invoicing system",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ken Tracker",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#151413",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

// CompactModeProvider + Toaster are mounted inside app/page.tsx itself
// (matching the real App.tsx, which wraps AppContent the same way) --
// not duplicated here.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${lato.variable}`}>
      <body>
        <PWARegister />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
