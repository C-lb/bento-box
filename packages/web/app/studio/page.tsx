import { getConnections } from "@event-editor/core/settings";
import { StudioClient } from "./StudioClient";

export default function StudioPage() {
  const google = getConnections().find((c) => c.id === "google");
  return (
    <div>
      <p className="eyebrow">Headshot studio</p>
      <h1 className="mt-1 text-2xl font-semibold">Turn a Drive photo into a branded headshot</h1>
      {!google?.configured ? (
        <div className="card mt-8">
          <p className="text-muted">Google credentials are not set in your environment yet.</p>
          <p className="mt-2 text-muted">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart.</p>
        </div>
      ) : (
        <StudioClient />
      )}
    </div>
  );
}
