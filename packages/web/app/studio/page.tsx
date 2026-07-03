import { getConnections } from "@event-editor/core/settings";
import { StudioTabs } from "./StudioTabs";
import { PastHeadshots } from "./PastHeadshots";

// Gates on a runtime API key (process.env); must render per request, not as a
// build-time static prerender (CI builds with no keys). See transcribe/page.tsx.
export const dynamic = "force-dynamic";

export default function StudioPage() {
  const google = getConnections().find((c) => c.id === "google");
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Headshot studio</p>
          <h1 className="mt-1 text-2xl font-semibold">Build branded headshots</h1>
        </div>
        <PastHeadshots />
      </div>
      {!google?.configured ? (
        <div className="card mt-8">
          <p className="text-muted">Google credentials are not set in your environment yet.</p>
          <p className="mt-2 text-muted">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then restart.</p>
        </div>
      ) : (
        <StudioTabs />
      )}
    </div>
  );
}
