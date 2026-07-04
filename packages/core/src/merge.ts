export type Rows = { headers: string[]; rows: Record<string, string>[] };
export type Align = "left" | "center" | "right";
export interface PageSize { width: number; height: number }

export interface TextElement {
  kind: "text";
  template: string;
  x: number; y: number; size: number;
  font: "heading" | "body";
  align: Align;
  color: string;
}
export interface ImageElement {
  kind: "image";
  src: string;
  x: number; y: number; width: number; height: number;
}
export type Element = TextElement | ImageElement;

export interface DocumentSpec {
  page: PageSize;
  background?: string;
  elements: Element[];
}

/** Replace `{Header}` tokens with the row's value (case-insensitive key match). */
export function resolveText(template: string, row: Record<string, string>): string {
  const lower = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = lower.get(key.trim().toLowerCase());
    return v == null ? "" : String(v);
  });
}
