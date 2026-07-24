import path from "node:path";

// The only keys the unlock code is allowed to fill in.
export const PRESET_KEYS = [
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_PICKER_API_KEY",
  "GOOGLE_PICKER_APP_ID",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

// Human names for the "Filled in the ... keys" confirmation.
export const PRESET_LABELS: Record<PresetKey, string> = {
  GROQ_API_KEY: "Groq",
  ANTHROPIC_API_KEY: "Claude",
  GOOGLE_CLIENT_ID: "Google client ID",
  GOOGLE_CLIENT_SECRET: "Google client secret",
  GOOGLE_PICKER_API_KEY: "Google Picker key",
  GOOGLE_PICKER_APP_ID: "Google Picker app ID",
  SPOTIFY_CLIENT_ID: "Spotify client ID",
  SPOTIFY_CLIENT_SECRET: "Spotify client secret",
};

// Fallback when neither the source .env nor the process env sets EE_UNLOCK_CODE.
export const DEFAULT_UNLOCK_CODE = "bentocaleb";

// Named groups a code can be scoped to, so one code can hand out only the AI
// keys while another hands out everything.
export const PRESET_GROUPS: Record<string, readonly PresetKey[]> = {
  groq: ["GROQ_API_KEY"],
  claude: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_PICKER_API_KEY", "GOOGLE_PICKER_APP_ID"],
  spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
};

// User-added codes live here as a comma-separated list. A bare code unlocks
// every preset key; `code:groq|claude` unlocks only those groups.
export const EXTRA_CODES_KEY = "EE_UNLOCK_CODES";

// scope === null means "all preset keys".
export type CodeEntry = { code: string; scope: PresetKey[] | null };

export function parseCodeEntry(raw: string): CodeEntry | null {
  const t = raw.trim();
  if (!t) return null;
  const colon = t.indexOf(":");
  if (colon === -1) return { code: t, scope: null };
  const code = t.slice(0, colon).trim();
  if (!code) return null;
  const scope = t
    .slice(colon + 1)
    .split("|")
    .flatMap((g) => {
      const group = PRESET_GROUPS[g.trim().toLowerCase()];
      return group ? [...group] : [];
    });
  return { code, scope: [...new Set(scope)] };
}

export function parseExtraCodes(raw: string | undefined | null): CodeEntry[] {
  return (raw ?? "")
    .split(",")
    .map((c) => parseCodeEntry(c))
    .filter((e): e is CodeEntry => e !== null);
}

// The preset keys a matched code is allowed to write.
export function scopedKeys(
  entry: CodeEntry,
  keys: Partial<Record<PresetKey, string>>,
): Partial<Record<PresetKey, string>> {
  if (entry.scope === null) return keys;
  const out: Partial<Record<PresetKey, string>> = {};
  for (const k of entry.scope) if (keys[k]) out[k] = keys[k];
  return out;
}

// Where preset keys are read from. Packaged builds can point EE_PRESET_ENV at a
// bundled env file; in dev the repo-root .env already holds the real keys
// (cwd is packages/web during `next dev`/`next start`).
export function presetSourcePath(): string {
  return process.env.EE_PRESET_ENV ?? path.resolve(process.cwd(), "..", "..", ".env");
}

export type Preset = { code: string; codes: CodeEntry[]; keys: Partial<Record<PresetKey, string>> };

// Pure resolution so it can be tested without touching the filesystem: the
// primary code comes from the process env, then the source file, then the
// default; `codes` adds any user-saved EE_UNLOCK_CODES, all of which unlock the
// same keys. Key values prefer the source file over the process env.
export function resolvePreset(
  fileValues: Record<string, string>,
  env: Record<string, string | undefined>,
): Preset {
  const code = env.EE_UNLOCK_CODE?.trim() || fileValues.EE_UNLOCK_CODE || DEFAULT_UNLOCK_CODE;
  const extras = parseExtraCodes(env[EXTRA_CODES_KEY] ?? fileValues[EXTRA_CODES_KEY]);
  // The primary code always unlocks everything; extras keep their own scope,
  // and a duplicate of the primary code is dropped.
  const codes: CodeEntry[] = [
    { code, scope: null },
    ...extras.filter((e) => e.code !== code),
  ];
  const keys: Partial<Record<PresetKey, string>> = {};
  for (const k of PRESET_KEYS) {
    const v = fileValues[k] ?? env[k]?.trim();
    if (v) keys[k] = v;
  }
  return { code, codes, keys };
}
