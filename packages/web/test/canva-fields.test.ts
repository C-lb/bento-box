import { describe, it, expect } from "vitest";
import { resolveTemplateFields } from "../lib/canva/fields";

const ok = { fields: [
  { name: "photo", type: "image" },
  { name: "name", type: "text" },
  { name: "title", type: "text" },
] };

describe("resolveTemplateFields", () => {
  it("maps the convention fields", () => {
    expect(resolveTemplateFields(ok)).toEqual({ photo: "photo", name: "name", title: "title" });
  });

  it("errors listing missing fields", () => {
    expect(() => resolveTemplateFields({ fields: [{ name: "photo", type: "image" }] }))
      .toThrow(/name.*title/);
  });

  it("errors when photo is not an image field", () => {
    expect(() => resolveTemplateFields({ fields: [
      { name: "photo", type: "text" }, { name: "name", type: "text" }, { name: "title", type: "text" },
    ] })).toThrow(/photo/);
  });
});
