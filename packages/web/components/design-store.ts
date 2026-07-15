/**
 * Per-tool persistence for design customisations (`DesignOverrides`), keyed
 * by tool id in `localStorage`. Defensive parse: anything malformed, the
 * wrong shape, or an unrecognised version silently falls back to `undefined`
 * so callers can layer their own defaults on top.
 */
import { sanitizeDesignOverrides, type DesignOverrides } from "@event-editor/core/design";

const KEY_PREFIX = "ee.design.";

function keyFor(toolId: string): string {
  return `${KEY_PREFIX}${toolId}`;
}

/**
 * Reads the persisted design overrides for a tool, or `undefined` if
 * absent/invalid. Values are deep-validated and clamped by the core
 * sanitizer, so hand-edited or stale localStorage can never smuggle
 * out-of-range values into a render.
 */
export function loadDesign(toolId: string): DesignOverrides | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(keyFor(toolId));
  if (!raw) return undefined;
  try {
    return sanitizeDesignOverrides(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** Persists design overrides for a tool. */
export function saveDesign(toolId: string, o: DesignOverrides): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(toolId), JSON.stringify(o));
  } catch {
    // quota exceeded or storage disabled (e.g. Safari lockdown mode): drop silently
  }
}

/** Removes any persisted design overrides for a tool. */
export function clearDesign(toolId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(toolId));
  } catch {
    // storage disabled: nothing to clean up
  }
}
