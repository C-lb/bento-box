"use client";
import { useEffect, useState } from "react";

// Live health chip: pings /api/spotify/status to confirm the credentials still
// authenticate. Client Credentials has no refresh token or expiry to count down,
// so this reflects real connectivity, not a timer.
export function SpotifyStatus() {
  const [state, setState] = useState<{ connected: boolean; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/spotify/status")
      .then((r) => r.json())
      .then((d) => { if (live) setState(d); })
      .catch(() => { if (live) setState({ connected: false, error: "Could not reach the server" }); });
    return () => { live = false; };
  }, []);

  const checking = state === null;
  const ready = state?.connected === true;

  return (
    <div className="mt-3">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 ${
          checking
            ? "bg-line/40 text-muted ring-line"
            : ready
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
              : "bg-amber-50 text-amber-700 ring-amber-600/20"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${checking ? "bg-muted" : ready ? "bg-emerald-500" : "bg-amber-500"}`} />
        {checking ? "Spotify checking…" : ready ? "Spotify connected" : "Spotify needs setup"}
      </span>
      {!checking && !ready && state?.error && (
        <p className="mt-1.5 text-sm text-muted">{state.error}</p>
      )}
    </div>
  );
}
