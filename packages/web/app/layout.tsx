import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = { title: "event-editor", description: "Photo sorter and headshot studio" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-semibold">event-editor</Link>
            <Link href="/settings" className="text-muted hover:text-ink" title="Connections">Settings</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
