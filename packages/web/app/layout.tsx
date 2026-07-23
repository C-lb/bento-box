import "./globals.css";
import type { ReactNode } from "react";
import { DesktopShortcuts } from "@/components/DesktopShortcuts";
import { Nav } from "@/components/Nav";
import { ToolSearch } from "@/components/ToolSearch";
import { ToolShellProvider } from "@/components/tool-shell-context";

export const metadata = { title: "Bento Box", description: "A box of small tools for events, images, media, and documents" };

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // Lock zoom: iOS auto-zooms on focus of sub-16px inputs and leaves the page
  // cropped off the left edge afterwards (app shell, so pinch-zoom is expendable).
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
  themeColor: "#f5f6f8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToolShellProvider>
          <DesktopShortcuts />
          {/* Opaque cap over the Dynamic Island / notch zone so cards scrolling
              under the sticky search bar never peek out beside the island. Zero
              height (invisible) on devices with no top inset. */}
          <div
            aria-hidden
            className="fixed inset-x-0 top-0 z-40 bg-canvas"
            style={{ height: "env(safe-area-inset-top)" }}
          />
          <Nav />
          <ToolSearch />
          <main className="mx-auto max-w-5xl px-3 pt-3 pb-16 sm:px-6 sm:pt-10 sm:pb-24">{children}</main>
        </ToolShellProvider>
      </body>
    </html>
  );
}
