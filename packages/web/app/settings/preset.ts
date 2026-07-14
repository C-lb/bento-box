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
export const DEFAULT_UNLOCK_CODE = "bento";

// Where preset keys are read from. Packaged builds can point EE_PRESET_ENV at a
// bundled env file; in dev the repo-root .env already holds the real keys
// (cwd is packages/web during `next dev`/`next start`).
export function presetSourcePath(): string {
  return process.env.EE_PRESET_ENV ?? path.resolve(process.cwd(), "..", "..", ".env");
}

export type Preset = { code: string; keys: Partial<Record<PresetKey, string>> };

// Pure resolution so it can be tested without touching the filesystem: the
// expected code comes from the process env, then the source file, then the
// default; key values prefer the source file over the process env.
export function resolvePreset(
  fileValues: Record<string, string>,
  env: Record<string, string | undefined>,
): Preset {
  const code = env.EE_UNLOCK_CODE?.trim() || fileValues.EE_UNLOCK_CODE || DEFAULT_UNLOCK_CODE;
  const keys: Partial<Record<PresetKey, string>> = {};
  for (const k of PRESET_KEYS) {
    const v = fileValues[k] ?? env[k]?.trim();
    if (v) keys[k] = v;
  }
  return { code, keys };
}
