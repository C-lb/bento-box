"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { upsertEnvKeys, upsertRawEnvKeys, readEnvValues, ENV_KEYS, type EnvKey } from "@event-editor/core/settings";
import { envFilePath } from "./env-path";
import {
  PRESET_KEYS,
  PRESET_LABELS,
  PRESET_GROUPS,
  presetSourcePath,
  resolvePreset,
  parseExtraCodes,
  parseCodeEntry,
  scopedKeys,
  EXTRA_CODES_KEY,
} from "./preset";

export type SaveState = { ok: boolean; message: string } | null;

export async function saveKeys(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const updates: Partial<Record<EnvKey, string>> = {};
  for (const key of ENV_KEYS) {
    const v = formData.get(key);
    if (typeof v === "string") updates[key] = v;
  }
  try {
    upsertEnvKeys(envFilePath(), updates);
    return { ok: true, message: "Saved. Restart the app to apply the new keys." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the keys." };
  }
}

function codesMatch(given: string, expected: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Setup-code shortcut: a matching code copies the Groq and Claude keys from the
// preset source (bundled/repo .env, falling back to the process env) into the
// user's env file, so a fresh install doesn't need keys pasted by hand.
export async function applyUnlockCode(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const given = formData.get("code");
  if (typeof given !== "string" || given.trim() === "") {
    return { ok: false, message: "Enter a code first." };
  }
  try {
    // Accepted codes come from the preset source AND any the user saved into
    // their own env file, so a saved code keeps working across installs.
    const presetFile = readEnvValues(presetSourcePath(), ["EE_UNLOCK_CODE", EXTRA_CODES_KEY, ...PRESET_KEYS]);
    const userExtras = readEnvValues(envFilePath(), [EXTRA_CODES_KEY]);
    const preset = resolvePreset(presetFile, process.env);
    const accepted = [...preset.codes, ...parseExtraCodes(userExtras[EXTRA_CODES_KEY])];
    const matched = accepted.find((c) => codesMatch(given.trim(), c.code));
    if (!matched) {
      return { ok: false, message: "That code didn't match." };
    }
    // A scoped code only fills the keys its groups cover.
    const allowed = scopedKeys(matched, preset.keys);
    const found = PRESET_KEYS.filter((k) => allowed[k]);
    if (found.length === 0) {
      return { ok: false, message: "Code accepted, but no preset keys were found on this machine." };
    }
    upsertEnvKeys(envFilePath(), allowed);
    const names = found.map((k) => PRESET_LABELS[k]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    return { ok: true, message: `Filled in the ${list} key${found.length > 1 ? "s" : ""}. Restart the app to apply.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not fill in the keys." };
  }
}

// Save a new setup code into the user's env file so it is accepted from now on
// (alongside the built-in code). Codes are stored comma-separated under
// EE_UNLOCK_CODES; adding one that is already present is a no-op.
export async function addSetupCode(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const given = formData.get("newCode");
  if (typeof given !== "string" || given.trim() === "") {
    return { ok: false, message: "Enter a setup code to save." };
  }
  const entryText = given.trim();
  if (entryText.includes(",")) {
    return { ok: false, message: "Setup codes can't contain a comma." };
  }
  // `name` unlocks every preset key; `name:groq|claude` unlocks only those groups.
  const entry = parseCodeEntry(entryText);
  if (!entry) {
    return { ok: false, message: "Enter a setup code to save." };
  }
  if (entry.scope !== null && entry.scope.length === 0) {
    const names = Object.keys(PRESET_GROUPS).join(", ");
    return { ok: false, message: `Unknown key group. Use one or more of: ${names}.` };
  }
  try {
    const raw = readEnvValues(envFilePath(), [EXTRA_CODES_KEY])[EXTRA_CODES_KEY];
    const existing = parseExtraCodes(raw);
    if (existing.some((e) => e.code === entry.code)) {
      return { ok: true, message: "That setup code is already saved." };
    }
    const next = [...(raw ?? "").split(",").map((c) => c.trim()).filter(Boolean), entryText];
    upsertRawEnvKeys(envFilePath(), { [EXTRA_CODES_KEY]: next.join(",") });
    return { ok: true, message: `Saved. ${next.length} setup code${next.length > 1 ? "s" : ""} now unlock the keys.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the setup code." };
  }
}
