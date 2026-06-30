import { describe, it, expect } from "vitest";
import { detectColumns } from "../src/columns.js";

describe("detectColumns", () => {
  it("maps exact headers case-insensitively", () => {
    expect(detectColumns(["Name", "TITLE", "Photo"])).toEqual({ name: 0, title: 1, photo: 2 });
  });
  it("uses synonyms", () => {
    expect(detectColumns(["Full Name", "Role", "Headshot"])).toEqual({ name: 0, title: 1, photo: 2 });
  });
  it("returns null for a missing field", () => {
    expect(detectColumns(["name", "department"])).toEqual({ name: 0, title: null, photo: null });
  });
  it("trims and ignores surrounding whitespace", () => {
    expect(detectColumns(["  name  ", " job title "])).toEqual({ name: 0, title: 1, photo: null });
  });
});
