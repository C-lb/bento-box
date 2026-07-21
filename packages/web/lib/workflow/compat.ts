import type { StepKind } from "./types";

export interface ChainableToolKind {
  toolId: string;
  inputKind: StepKind;
  outputKind: StepKind;
}

// Mirrors the table in docs/superpowers/specs/2026-07-21-workflow-tab-design.md
// §1 exactly. cutout/certificate/badge/place-card/ticket are deliberately
// absent — no server processing route today, out of scope per spec non-goals.
export const CHAINABLE_KINDS: ChainableToolKind[] = [
  { toolId: "convert", inputKind: "file", outputKind: "file" },
  { toolId: "heic", inputKind: "file", outputKind: "file" },
  { toolId: "resize", inputKind: "file", outputKind: "file" },
  { toolId: "pdf", inputKind: "file", outputKind: "file" },
  { toolId: "video", inputKind: "file", outputKind: "file" },
  { toolId: "splice", inputKind: "files", outputKind: "file" },
  { toolId: "slice", inputKind: "file", outputKind: "files" },
  { toolId: "shorten", inputKind: "url-text", outputKind: "url-text" },
  { toolId: "qr", inputKind: "url-text", outputKind: "file" },
  { toolId: "sorter", inputKind: "none", outputKind: "drive-ranked-list" },
  { toolId: "transcribe", inputKind: "file", outputKind: "doc" },
  { toolId: "studio", inputKind: "none", outputKind: "headshot-batch" },
];

const BY_ID = new Map(CHAINABLE_KINDS.map((k) => [k.toolId, k]));

export function isChainable(toolId: string): boolean {
  return BY_ID.has(toolId);
}

export function kindsFor(toolId: string): ChainableToolKind | undefined {
  return BY_ID.get(toolId);
}

export function canFollow(prevOutputKind: StepKind, nextInputKind: StepKind): boolean {
  return nextInputKind !== "none" && prevOutputKind === nextInputKind;
}

export function compatibleNextTools(prevOutputKind: StepKind | null): ChainableToolKind[] {
  if (prevOutputKind === null) return CHAINABLE_KINDS.slice();
  return CHAINABLE_KINDS.filter((k) => canFollow(prevOutputKind, k.inputKind));
}
