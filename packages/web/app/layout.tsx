import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { ToolSearch } from "@/components/ToolSearch";
import { ToolShellProvider } from "@/components/tool-shell-context";

export const metadata = { title: "Bento", description: "A box of small tools for events, images, media, and documents" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToolShellProvider>
          <Nav />
          <ToolSearch />
          <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
        </ToolShellProvider>
      </body>
    </html>
  );
}
