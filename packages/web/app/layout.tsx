import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";

export const metadata = { title: "event-editor", description: "Photo sorter, transcriber, and headshot studio" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
