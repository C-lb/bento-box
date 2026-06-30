"use server";

import { upsertEnvKeys, ENV_KEYS, type EnvKey } from "@event-editor/core/settings";
import { envFilePath } from "./env-path";

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
