/** Per-tool persistence for the F3 custom canvas design, keyed by tool id in
 * localStorage (binary assets live in IndexedDB — see lib/design-assets.ts).
 * Defensive parse mirrors design-store.ts. */
import type { CustomDesign } from "@event-editor/core/custom-design";

const KEY_PREFIX = "ee.customDesign.";

function keyFor(toolId: string): string {
  return `${KEY_PREFIX}${toolId}`;
}

function isCustomDesign(x: unknown): x is CustomDesign {
  return !!x && typeof x === "object"
    && (x as { v?: unknown }).v === 1
    && Array.isArray((x as { elements?: unknown }).elements)
    && !!(x as { page?: { width?: unknown } }).page;
}

export function loadCustomDesign(toolId: string): CustomDesign | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(keyFor(toolId));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return isCustomDesign(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveCustomDesign(toolId: string, d: CustomDesign): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(toolId), JSON.stringify(d));
  } catch {
    // quota exceeded or storage disabled: drop silently
  }
}

export function clearCustomDesign(toolId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(keyFor(toolId));
  } catch {
    // storage disabled: nothing to clean up
  }
}
