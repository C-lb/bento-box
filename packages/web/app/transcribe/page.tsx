import { getConnections } from "@event-editor/core/settings";
import { TranscribeClient } from "./TranscribeClient";
import { PastTranscriptions } from "./PastTranscriptions";

// Reads API keys from process.env at render. Must run per request: the packaged
// app injects keys at launch from the per-user .env, so a build-time static
// prerender (no keys in CI) would freeze the "not configured" gate forever.
export const dynamic = "force-dynamic";

export default function TranscribePage() {
  const conns = getConnections();
  const groq = conns.find((c) => c.id === "groq");
  const google = conns.find((c) => c.id === "google");
  const anthropic = conns.find((c) => c.id === "anthropic");
  const missing: string[] = [];
  if (!groq?.configured) missing.push("GROQ_API_KEY");
  if (!anthropic?.configured) missing.push("ANTHROPIC_API_KEY");
  if (!google?.configured) missing.push("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Audio transcriber</p>
          <h1 className="mt-1 text-2xl font-semibold">Transcribe audio to a Google Doc</h1>
        </div>
        <PastTranscriptions />
      </div>
      {missing.length > 0 ? (
        <div className="card mt-8">
          <p className="text-muted">Set these in .env, then restart:</p>
          <ul className="mt-2 list-disc pl-5 text-muted">
            {missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p className="mt-2 text-muted">
            Google also needs write access for this tool. Re-auth on{" "}
            <a className="underline" href="/settings">settings</a> after connecting.
          </p>
        </div>
      ) : (
        <TranscribeClient />
      )}
    </div>
  );
}
