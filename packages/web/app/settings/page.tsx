import { getConnections, ENV_KEYS } from "@event-editor/core/settings";
import { getToken } from "@event-editor/core/tokens";
import { getDb } from "@/lib/db";
import { DRIVE_FILE_SCOPE, SHEETS_SCOPE } from "@/lib/google/oauth";
import { KeyForm } from "./KeyForm";
import { envFilePath } from "./env-path";

// Reads keys from process.env per request; must not be statically prerendered.
export const dynamic = "force-dynamic";

export default function Settings({ searchParams }: { searchParams: Promise<{ google?: string; canva?: string }> }) {
  return <SettingsBody searchParams={searchParams} />;
}

async function SettingsBody({ searchParams }: { searchParams: Promise<{ google?: string; canva?: string }> }) {
  const { google, canva } = await searchParams;
  const connections = getConnections();
  const googleToken = getToken(getDb(), "google");
  const scope = googleToken?.scope ?? "";
  const needsReauth = googleToken !== null && (!scope.includes(DRIVE_FILE_SCOPE) || !scope.includes(SHEETS_SCOPE));
  const canvaConfigured = !!process.env.CANVA_CLIENT_ID;
  const canvaToken = getToken(getDb(), "canva");
  // Only whether each key is set (never the value) crosses to the client.
  const present = Object.fromEntries(ENV_KEYS.map((k) => [k, !!process.env[k]?.trim()]));
  return (
    <div>
      <p className="eyebrow">Settings</p>
      <h1 className="mt-1 text-2xl font-semibold">Settings</h1>

      <h2 className="mt-8 text-lg font-semibold">API keys</h2>
      <KeyForm present={present} configPath={envFilePath()} />

      <h2 className="mt-10 text-lg font-semibold">Connections</h2>
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
                  Write and Sheets access needed for the transcriber and batch headshots. Re-auth below.
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
