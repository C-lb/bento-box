export type ConnectionId = "google" | "anthropic" | "canva" | "groq";

export interface Connection {
  id: ConnectionId;
  label: string;
  configured: boolean;
}

type Env = Record<string, string | undefined>;

const REQUIRED: Record<ConnectionId, { label: string; vars: string[] }> = {
  google: { label: "Google Drive", vars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  anthropic: { label: "Claude (Anthropic)", vars: ["ANTHROPIC_API_KEY"] },
  canva: { label: "Canva", vars: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"] },
  groq: { label: "Groq (transcription)", vars: ["GROQ_API_KEY"] },
};

export function getConnections(env: Env = process.env): Connection[] {
  return (Object.keys(REQUIRED) as ConnectionId[]).map((id) => ({
    id,
    label: REQUIRED[id].label,
    configured: REQUIRED[id].vars.every((v) => !!env[v] && env[v]!.trim() !== ""),
  }));
}

// The only keys the in-app settings form is allowed to write. Anything else
// (PATH, EE_*, etc.) is rejected so a form post can never inject arbitrary env.
export const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
  "CANVA_CLIENT_ID",
  "CANVA_CLIENT_SECRET",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

// Merge the given key/value updates into a dotenv-style file, in place:
// existing keys are rewritten where they sit (comments and unrelated lines
// preserved), new keys are appended. Blank/whitespace/undefined values are
// skipped so a left-blank field keeps the current value rather than wiping it.
// Keys outside ENV_KEYS are ignored. Used by the packaged app's settings form,
// which writes the per-user .env that main.js loads at launch.
export function upsertEnvKeys(file: string, updates: Partial<Record<EnvKey, string | undefined>>): void {
  const clean: Partial<Record<EnvKey, string>> = {};
  for (const key of ENV_KEYS) {
    const raw = updates[key];
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (v !== "") clean[key] = v;
  }
  if (Object.keys(clean).length === 0) return;

  // readFileSync/writeFileSync via a local require so this stays a pure module
  // (no top-level node:fs import) consistent with the rest of settings.ts.
  const { readFileSync, writeFileSync, existsSync } = require("node:fs") as typeof import("node:fs");

  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = existing === "" ? [] : existing.split("\n");
  const remaining = new Set(Object.keys(clean) as EnvKey[]);

  const next = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    const eq = t.indexOf("=");
    if (eq === -1) return line;
    const k = t.slice(0, eq).trim() as EnvKey;
    if (remaining.has(k)) {
      remaining.delete(k);
      return `${k}=${clean[k]}`;
    }
    return line;
  });

  for (const k of remaining) next.push(`${k}=${clean[k]}`);

  // Keep a single trailing newline.
  let out = next.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  writeFileSync(file, out);
}
