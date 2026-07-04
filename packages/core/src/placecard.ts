import type { DocumentSpec, TextElement } from "./merge.js";

export const PLACECARD_LAYOUTS = [
  { id: "classic", label: "Classic" },
  { id: "withTable", label: "With table" },
] as const;

export type PlaceCardLayout = (typeof PLACECARD_LAYOUTS)[number]["id"];

export interface PlaceCardOptions {
  layout: PlaceCardLayout;
  nameField: string;
  tableField: string;
}

const CELL = { width: 288, height: 180 };
const CX = CELL.width / 2;

export function placecardSpec(opts: PlaceCardOptions): DocumentSpec {
  const name = `{${opts.nameField || "Name"}}`;
  const els: TextElement[] = [];
  if (opts.layout === "withTable") {
    els.push({ kind: "text", template: name, x: CX, y: 96, size: 30, font: "heading", align: "center", color: "#1a1a1a" });
    els.push({ kind: "text", template: `Table {${opts.tableField || "Table"}}`, x: CX, y: 58, size: 14, font: "body", align: "center", color: "#555555" });
  } else {
    els.push({ kind: "text", template: name, x: CX, y: 78, size: 32, font: "heading", align: "center", color: "#1a1a1a" });
  }
  return { page: { ...CELL }, elements: els };
}
