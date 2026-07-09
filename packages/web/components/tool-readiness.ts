import type { Tool } from "@/components/tools";
import type { ConnectionId } from "@event-editor/core/settings";
import type { DepId } from "@/lib/deps";

export type Health = {
  deps: { id: DepId; ready: boolean }[];
  keys: { id: ConnectionId; configured: boolean }[];
};

export type Readiness = {
  ready: boolean;
  missingKeys: ConnectionId[];
  missingDeps: DepId[];
};

// Human labels for the tooltip. Keys use "<thing> API key" phrasing; deps use
// the product name. Unknown ids never reach here (filtered by the resolver).
const KEY_LABEL: Record<ConnectionId, string> = {
  groq: "Groq API key",
  anthropic: "Claude API key",
  google: "Google sign-in",
  canva: "Canva sign-in",
};

const DEP_LABEL: Record<DepId, string> = {
  ffmpeg: "FFmpeg",
  ytdlp: "yt-dlp",
  libreoffice: "LibreOffice",
};

export function toolReadiness(tool: Tool, health: Health): Readiness {
  const wantKeys = tool.requires?.keys ?? [];
  const wantDeps = tool.requires?.deps ?? [];

  const keyConfigured = new Map(health.keys.map((k) => [k.id, k.configured]));
  const depReady = new Map(health.deps.map((d) => [d.id, d.ready]));

  // A requirement counts as satisfied unless we positively know it is missing.
  // Unknown ids (not in the health map) are treated as satisfied so a typo
  // can never permanently block a tool.
  const missingKeys = wantKeys.filter((id) => keyConfigured.get(id) === false);
  const missingDeps = wantDeps.filter((id) => depReady.get(id) === false);

  return {
    ready: missingKeys.length === 0 && missingDeps.length === 0,
    missingKeys,
    missingDeps,
  };
}

export function requirementTooltip(r: Readiness): string {
  const parts = [
    ...r.missingKeys.map((id) => KEY_LABEL[id]),
    ...r.missingDeps.map((id) => DEP_LABEL[id]),
  ];
  return `Feature not available: needs ${parts.join(", ")}`;
}

export function settingsHref(r: Readiness): string {
  return r.missingKeys.length > 0 ? "/settings#api-keys" : "/settings#dependencies";
}
