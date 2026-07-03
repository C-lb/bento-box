import { TOOLS, searchTools, type Tool } from "@/components/tools";

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

// --- reducers ---

export function toggleFavourite(state: ToolShellState, toolId: string): ToolShellState {
  const has = state.favourites.includes(toolId);
  return {
    ...state,
    favourites: has ? state.favourites.filter((f) => f !== toolId) : [...state.favourites, toolId],
  };
}

export function setMembership(
  state: ToolShellState,
  tool: Tool,
  groupId: string,
  on: boolean,
): ToolShellState {
  const current = state.membership[tool.id] ?? tool.defaultGroups;
  const next = on
    ? current.includes(groupId)
      ? [...current]
      : [...current, groupId]
    : current.filter((g) => g !== groupId);
  return { ...state, membership: { ...state.membership, [tool.id]: next } };
}

export function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "group";
}

export function createGroup(
  state: ToolShellState,
  label: string,
  addToolId?: string,
): { state: ToolShellState; id: string } {
  const base = slugify(label);
  let id = base;
  let n = 2;
  const taken = new Set([FAV, ...state.groups]);
  while (taken.has(id)) id = `${base}-${n++}`;
  const groups = [...state.groups, id];
  const groupLabels = { ...state.groupLabels, [id]: label.trim() || id };
  let membership = state.membership;
  if (addToolId) {
    const tool = TOOLS.find((t) => t.id === addToolId);
    const current = membership[addToolId] ?? tool?.defaultGroups ?? [];
    membership = { ...membership, [addToolId]: [...current, id] };
  }
  return { state: { ...state, groups, groupLabels, membership }, id };
}

export function renameGroup(state: ToolShellState, groupId: string, label: string): ToolShellState {
  if (!state.groups.includes(groupId)) return state;
  const next = label.trim() === "" ? groupId : label;
  return { ...state, groupLabels: { ...state.groupLabels, [groupId]: next } };
}

export function deleteGroup(state: ToolShellState, groupId: string): ToolShellState {
  const groups = state.groups.filter((g) => g !== groupId);
  const groupLabels = { ...state.groupLabels };
  delete groupLabels[groupId];
  const membership: Record<string, string[]> = {};
  for (const [toolId, gs] of Object.entries(state.membership)) {
    membership[toolId] = gs.filter((g) => g !== groupId);
  }
  return { ...state, groups, groupLabels, membership };
}

export function reorderGroups(state: ToolShellState, orderedIds: string[]): ToolShellState {
  const known = orderedIds.filter((g) => state.groups.includes(g));
  const missing = state.groups.filter((g) => !known.includes(g));
  return { ...state, groups: [...known, ...missing] };
}

// --- search bar reveal-on-scroll (append to components/tool-store.ts) ---

export function nextSearchVisibility(prevY: number, curY: number, threshold: number): boolean {
  if (curY <= threshold) return true; // near the top: always show
  if (curY > prevY) return false; // scrolling down: hide
  return true; // scrolling up or unchanged: show
}
