import type { CanvaDataset } from "./client";

export function resolveTemplateFields(dataset: CanvaDataset): { photo: string; name: string; title: string } {
  const by = new Map(dataset.fields.map((f) => [f.name, f.type]));
  const missing: string[] = [];
  if (by.get("photo") !== "image") missing.push("photo (image field)");
  if (by.get("name") !== "text") missing.push("name (text field)");
  if (by.get("title") !== "text") missing.push("title (text field)");
  if (missing.length) {
    throw new Error(`Template is missing required fields: ${missing.join(", ")}. Add them in Canva.`);
  }
  return { photo: "photo", name: "name", title: "title" };
}
