"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dep } from "@/lib/deps";

function StatusPill({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 ${
        ready
          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
          : "bg-ink/5 text-muted ring-line"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-muted/50"}`} />
      {ready ? "Ready" : "Not installed"}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="ico animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Dependencies({ deps }: { deps: Dep[] }) {
  return (
    <div className="card mt-4 divide-y divide-line">
      {deps.map((dep) => (
        <DependencyRow key={dep.id} dep={dep} />
      ))}
    </div>
  );
}

function DependencyRow({ dep }: { dep: Dep }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function downloadYtDlp() {
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/deps/ytdlp", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        setResult({ ok: false, message: data.error ?? "Download failed. Try again." });
      } else {
        setResult({ ok: true, message: `Installed yt-dlp ${data.version}` });
        router.refresh();
      }
    } catch {
      setResult({ ok: false, message: "Download failed. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-ink">{dep.label}</span>
          <StatusPill ready={dep.ready} />
          {dep.version && <span className="text-sm text-muted">{dep.version}</span>}
        </div>
        {dep.hint && <p className="mt-1 text-sm text-muted">{dep.hint}</p>}
        {result && (
          <p className={`mt-1 text-sm ${result.ok ? "text-success" : "text-danger"}`}>{result.message}</p>
        )}
      </div>

      {dep.managed && (
        <button
          type="button"
          className="btn btn-accent shrink-0"
          disabled={pending}
          onClick={downloadYtDlp}
        >
          {pending && <Spinner />}
          {pending ? "Downloading" : dep.ready ? "Update" : "Download"}
        </button>
      )}

      {!dep.managed && dep.installUrl && (
        <button
          type="button"
          className="btn shrink-0"
          onClick={() => window.open(dep.installUrl!, "_blank", "noopener")}
        >
          Open download page
        </button>
      )}
    </div>
  );
}
