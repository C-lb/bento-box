import { searchTools, type Tool } from "@/components/tools";

export const FAV = "fav"; // reserved favourites group id, always rendered first

export const DEFAULT_GROUP_ORDER = ["events", "images", "media", "documents"];
export const DEFAULT_GROUP_LABELS: Record<string, string> = {
  events: "Events",
  images: "Images",
  media: "Media",
  documents: "Documents",
};

export type ToolShellState = {
  version: 1;
  groups: string[]; // ordered group ids, excludes FAV (which is implicit-first)
  groupLabels: Record<string, string>;
  membership: Record<string, string[]>; // toolId -> group ids (override; absent = use defaultGroups)
  favourites: string[]; // tool ids
};

export function seedState(): ToolShellState {
  return {
    version: 1,
    groups: [...DEFAULT_GROUP_ORDER],
    groupLabels: { ...DEFAULT_GROUP_LABELS },
    membership: {},
    favourites: [],
  };
}

export function effectiveGroups(state: ToolShellState, tool: Tool): string[] {
  const raw = state.membership[tool.id] ?? tool.defaultGroups;
  return raw.filter((g) => state.groups.includes(g));
}

export function toolsInGroup(state: ToolShellState, tools: Tool[], groupId: string): Tool[] {
  return tools.filter((t) => effectiveGroups(state, t).includes(groupId));
}

export function visibleTools(
  state: ToolShellState,
  tools: Tool[],
  activeGroup: string,
  query: string,
): Tool[] {
  if (query.trim()) return searchTools(tools, query);
  if (activeGroup === FAV) return tools.filter((t) => state.favourites.includes(t.id));
  return toolsInGroup(state, tools, activeGroup);
}

export const TOOL_SHELL_KEY = "ee.toolShell";
export const TOOL_SHELL_EVENT = "ee:tool-shell-change";

export function parseToolShell(raw: string | null): ToolShellState {
  if (!raw) return seedState();
  try {
    const p = JSON.parse(raw);
    if (
      !p ||
      p.version !== 1 ||
      !Array.isArray(p.groups) ||
      typeof p.groupLabels !== "object" ||
      typeof p.membership !== "object" ||
      !Array.isArray(p.favourites)
    ) {
      return seedState();
    }
    return {
      version: 1,
      groups: p.groups.filter((g: unknown): g is string => typeof g === "string"),
      groupLabels: p.groupLabels,
      membership: p.membership,
      favourites: p.favourites.filter((f: unknown): f is string => typeof f === "string"),
    };
  } catch {
    return seedState();
  }
}

export function readToolShell(): ToolShellState {
  if (typeof window === "undefined") return seedState();
  return parseToolShell(window.localStorage.getItem(TOOL_SHELL_KEY));
}

export function writeToolShell(state: ToolShellState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOOL_SHELL_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(TOOL_SHELL_EVENT));
}
