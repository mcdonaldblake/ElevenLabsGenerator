import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ElevenLabs Generator",
  description: "A private, browser-session workspace for auditioning voices and generating downloadable audio.",
  applicationName: "ElevenLabs Generator",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Voice Lab", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101d32",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
