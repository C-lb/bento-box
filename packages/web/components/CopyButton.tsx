"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text, html }: { text: string; html?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        // Write both flavours: rich targets (docs, email) take text/html and keep
        // the bold headers; plain targets (LinkedIn's editor) take text/plain.
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }
      catch { /* clipboard blocked; ignore */ }
    }
  }
  return (
    <button type="button" className="btn inline-flex items-center gap-2" onClick={copy}>
      {done ? <Check className="w-4 h-4" strokeWidth={1.75} /> : <Copy className="w-4 h-4" strokeWidth={1.75} />}
      {done ? "Copied!" : "Copy"}
    </button>
  );
}
