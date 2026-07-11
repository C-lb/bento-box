"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { upsertEnvKeys, readEnvValues, ENV_KEYS, type EnvKey } from "@event-editor/core/settings";
import { envFilePath } from "./env-path";
import { PRESET_KEYS, presetSourcePath, resolvePreset } from "./preset";

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
    const fileValues = readEnvValues(presetSourcePath(), ["EE_UNLOCK_CODE", ...PRESET_KEYS]);
    const preset = resolvePreset(fileValues, process.env);
    if (!codesMatch(given.trim(), preset.code)) {
      return { ok: false, message: "That code didn't match." };
    }
    const found = PRESET_KEYS.filter((k) => preset.keys[k]);
    if (found.length === 0) {
      return { ok: false, message: "Code accepted, but no preset keys were found on this machine." };
    }
    upsertEnvKeys(envFilePath(), preset.keys);
    const names = found.map((k) => (k === "GROQ_API_KEY" ? "Groq" : "Claude")).join(" and ");
    return { ok: true, message: `Filled in the ${names} key${found.length > 1 ? "s" : ""}. Restart the app to apply.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not fill in the keys." };
  }
}
