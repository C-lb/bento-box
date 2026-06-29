import { getConnections } from "@event-editor/core/settings";
import { getToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";
import { DRIVE_FILE_SCOPE } from "@/lib/google/oauth";

export default function Settings({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  return <SettingsBody searchParams={searchParams} />;
}

async function SettingsBody({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const connections = getConnections();
  const googleToken = getToken(getDb(), "google");
  const needsReauth =
    googleToken !== null && !(googleToken.scope ?? "").includes(DRIVE_FILE_SCOPE);
  return (
    <div>
      <p className="eyebrow">Settings</p>
      <h1 className="mt-1 text-2xl font-semibold">Connections</h1>
      {google === "connected" && <p className="mt-3 text-success">Google connected.</p>}
      {google === "error" && <p className="mt-3 text-danger">Google connection failed. Try again.</p>}
      <ul className="mt-8 space-y-3">
        {connections.map((c) => (
          <li key={c.id} className="card flex items-center justify-between">
            <span>{c.label}</span>
            <span className="flex items-center gap-3">
              <span className={c.configured ? "text-success" : "text-muted"}>
                {c.configured ? "Connected" : "Not configured"}
              </span>
              {c.id === "google" && c.configured && needsReauth && (
                <span className="text-sm text-muted">
                  Write access needed for Audio transcriber. Re-auth below.
                </span>
              )}
              {c.id === "google" && c.configured && (
                <a className="btn" href="/api/google/auth">Re-auth</a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
