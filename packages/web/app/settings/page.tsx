import { getConnections } from "@event-editor/core/settings";
import { getToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";
import { DRIVE_FILE_SCOPE } from "@/lib/google/oauth";

export default function Settings({ searchParams }: { searchParams: Promise<{ google?: string; canva?: string }> }) {
  return <SettingsBody searchParams={searchParams} />;
}

async function SettingsBody({ searchParams }: { searchParams: Promise<{ google?: string; canva?: string }> }) {
  const { google, canva } = await searchParams;
  const connections = getConnections();
  const googleToken = getToken(getDb(), "google");
  const needsReauth =
    googleToken !== null && !(googleToken.scope ?? "").includes(DRIVE_FILE_SCOPE);
  const canvaConfigured = !!process.env.CANVA_CLIENT_ID;
  const canvaToken = getToken(getDb(), "canva");
  return (
    <div>
      <p className="eyebrow">Settings</p>
      <h1 className="mt-1 text-2xl font-semibold">Connections</h1>
      {google === "connected" && <p className="mt-3 text-success">Google connected.</p>}
      {google === "error" && <p className="mt-3 text-danger">Google connection failed. Try again.</p>}
      {canva === "connected" && <p className="mt-3 text-success">Canva connected.</p>}
      {canva === "error" && <p className="mt-3 text-danger">Canva connection failed. Check CANVA_CLIENT_ID and try again.</p>}
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
      <ul className="mt-3 space-y-3">
        <li className="card flex items-center justify-between">
          <span>Canva (Headshot Studio)</span>
          <span className="flex items-center gap-3">
            <span className={canvaToken ? "text-success" : canvaConfigured ? "text-muted" : "text-danger"}>
              {canvaToken ? "Connected" : canvaConfigured ? "Not connected" : "Set CANVA_CLIENT_ID"}
            </span>
            {canvaConfigured && (
              <a className="btn" href="/api/canva/auth">{canvaToken ? "Re-auth" : "Connect"}</a>
            )}
          </span>
        </li>
      </ul>
    </div>
  );
}
