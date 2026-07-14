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
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

// A censored preview of a stored secret so the UI can prove it's really set
// without revealing it: first and last few characters, dots between. Short
// values are fully masked so nothing meaningful leaks.
export function maskSecret(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(6)}${v.slice(-4)}`;
}

// Read the given keys out of a dotenv-style file. Missing file, comments,
// malformed lines, and blank values are all skipped; surrounding quotes are
// stripped. Used by the settings unlock code to pull preset keys from a
// bundled/repo .env without loading it into process.env.
export function readEnvValues(file: string, keys: readonly string[]): Record<string, string> {
  const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
  if (!existsSync(file)) return {};
  const wanted = new Set(keys);
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (!wanted.has(k)) continue;
    let v = t.slice(eq + 1).trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    if (v !== "") out[k] = v;
  }
  return out;
}

// Merge the given key/value updates into a dotenv-style file, in place:
// existing keys are rewritten where they sit (comments and unrelated lines
// preserved), new keys are appended. Blank/whitespace/undefined values are
// skipped so a left-blank field keeps the current value rather than wiping it.
// Keys outside ENV_KEYS are ignored. Used by the packaged app's settings form,
// which writes the per-user .env that main.js loads at launch.
export function upsertEnvKeys(file: string, updates: Partial<Record<EnvKey, string | undefined>>): void {
  const clean: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const raw = updates[key];
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (v !== "") clean[key] = v;
  }
  upsertRawEnvKeys(file, clean);
}

// Merge arbitrary key/value pairs into the dotenv file, preserving comments and
// unrelated lines. Unlike upsertEnvKeys this is NOT limited to ENV_KEYS, so it
// can persist config such as EE_UNLOCK_CODES that the user manages by hand.
export function upsertRawEnvKeys(file: string, clean: Record<string, string>): void {
  if (Object.keys(clean).length === 0) return;

  // readFileSync/writeFileSync via a local require so this stays a pure module
  // (no top-level node:fs import) consistent with the rest of settings.ts.
  const { readFileSync, writeFileSync, existsSync } = require("node:fs") as typeof import("node:fs");

  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = existing === "" ? [] : existing.split("\n");
  const remaining = new Set(Object.keys(clean));

  const next = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    const eq = t.indexOf("=");
    if (eq === -1) return line;
    const k = t.slice(0, eq).trim();
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
