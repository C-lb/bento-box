import { getConnections } from "@event-editor/core/settings";
import { SorterClient } from "./SorterClient";

// Gates on a runtime API key (process.env); must render per request, not as a
// build-time static prerender (CI builds with no keys). See transcribe/page.tsx.
export const dynamic = "force-dynamic";

export default function SorterPage() {
  const google = getConnections().find((c) => c.id === "google");
  return (
    <div>
      <p className="eyebrow">Photo sorter</p>
      <h1 className="mt-1 text-2xl font-semibold">Rank Drive photos for LinkedIn</h1>
      {!google?.configured ? (
        <div className="card mt-8">
          <p className="text-muted">Google credentials are not set in your environment yet.</p>
          <p className="mt-2 text-muted">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart.</p>
        </div>
      ) : (
        <SorterClient />
      )}
    </div>
  );
}
