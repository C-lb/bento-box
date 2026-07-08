import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { ToolSearch } from "@/components/ToolSearch";
import { ToolShellProvider } from "@/components/tool-shell-context";

export const metadata = { title: "Bento", description: "A box of small tools for events, images, media, and documents" };

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#f5f6f8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToolShellProvider>
          <Nav />
          <ToolSearch />
          <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">{children}</main>
        </ToolShellProvider>
      </body>
    </html>
  );
}
