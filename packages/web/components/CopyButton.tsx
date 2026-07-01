"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch { /* clipboard blocked; ignore */ }
  }
  return (
    <button type="button" className="btn inline-flex items-center gap-2" onClick={copy}>
      {done ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {done ? "Copied!" : "Copy"}
    </button>
  );
}
