import { describe, it, expect } from "vitest";
import { badgeSpec, BADGE_LAYOUTS } from "./badge.js";
import { deriveFields } from "./merge.js";

const base = { nameField: "Name", orgField: "Org", eventTitle: "SPARK Summit" } as const;

describe("badgeSpec", () => {
  it("is a 4x3in badge cell (288x216)", () => {
    const s = badgeSpec({ ...base, layout: "centered", qr: false });
    expect(s.page).toEqual({ width: 288, height: 216 });
  });
  it("exposes name and org as mergeable fields", () => {
    const s = badgeSpec({ ...base, layout: "centered", qr: false });
    expect(deriveFields(s)).toEqual(["Name", "Org"]);
  });
  it("adds a qr element (of the name) only when qr is true", () => {
    const withQr = badgeSpec({ ...base, layout: "centered", qr: true });
    const without = badgeSpec({ ...base, layout: "centered", qr: false });
    expect(withQr.elements.some((e) => e.kind === "qr")).toBe(true);
    expect(without.elements.some((e) => e.kind === "qr")).toBe(false);
    const qr = withQr.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.value).toBe("{Name}");
  });
  it("honours custom field names", () => {
    const s = badgeSpec({ ...base, nameField: "Attendee", orgField: "Company", layout: "leftQr", qr: true });
    expect(deriveFields(s)).toEqual(["Attendee", "Company"]);
  });
  it("lists two layouts", () => {
    expect(BADGE_LAYOUTS.map((l) => l.id)).toEqual(["centered", "leftQr"]);
  });
});
