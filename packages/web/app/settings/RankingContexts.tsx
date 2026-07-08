"use client";
import { useEffect, useState } from "react";

type Data = { instagram: string; linkedin: string; defaults: { instagram: string; linkedin: string } };
const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
] as const;
type PlatformId = (typeof PLATFORMS)[number]["id"];

export function RankingContexts() {
  const [data, setData] = useState<Data | null>(null);
  const [text, setText] = useState<Record<PlatformId, string>>({ instagram: "", linkedin: "" });
  const [status, setStatus] = useState<Record<PlatformId, string>>({ instagram: "", linkedin: "" });

  useEffect(() => {
    fetch("/api/ranking-context").then(async (r) => {
      const d: Data = await r.json();
      setData(d);
      setText({ instagram: d.instagram, linkedin: d.linkedin });
    });
  }, []);

  async function save(p: PlatformId) {
    setStatus((s) => ({ ...s, [p]: "Saving" }));
    const r = await fetch("/api/ranking-context", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: p, text: text[p] }),
    });
    setStatus((s) => ({ ...s, [p]: r.ok ? "Saved" : "Save failed" }));
  }

  async function reset(p: PlatformId) {
    const r = await fetch(`/api/ranking-context?platform=${p}`, { method: "DELETE" });
    if (r.ok) {
      const { text: restored } = await r.json();
      setText((t) => ({ ...t, [p]: restored }));
      setStatus((s) => ({ ...s, [p]: "Reset to default" }));
    }
  }

  if (!data) return <p className="mt-4 text-sm text-muted">Loading…</p>;

  return (
    <div className="mt-4 space-y-6">
      {PLATFORMS.map((p) => (
        <div key={p.id}>
          <label className="mb-1 block text-sm font-medium text-ink">{p.label}</label>
          <textarea
            className="field min-h-28 w-full"
            value={text[p.id]}
            onChange={(e) => {
              const v = e.target.value;
              setText((t) => ({ ...t, [p.id]: v }));
              setStatus((s) => ({ ...s, [p.id]: "" }));
            }}
          />
          <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3">
            <button type="button" className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={() => save(p.id)}>Save</button>
            <button type="button" className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={() => reset(p.id)}>Reset to default</button>
            {status[p.id] && <span className="text-sm text-muted">{status[p.id]}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
