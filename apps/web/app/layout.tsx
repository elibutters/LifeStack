import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { RegisterServiceWorker } from "./register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life Stack",
  appleWebApp: { capable: true, title: "Life Stack", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
