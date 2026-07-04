import { describe, it, expect } from "vitest";
import { ticketSpec, TICKET_LAYOUTS } from "./ticket.js";
import { deriveFields } from "./merge.js";

const base = { eventTitle: "SPARK Summit", nameField: "Name", codeField: "Code" } as const;

describe("ticketSpec", () => {
  it("is a 5.5x2in ticket cell (396x144)", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: true });
    expect(s.page).toEqual({ width: 396, height: 144 });
  });
  it("encodes the code field in the QR", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: true });
    const qr = s.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.value).toBe("{Code}");
  });
  it("falls back to the name field for the QR when codeField is empty", () => {
    const s = ticketSpec({ ...base, codeField: "", layout: "classic", qr: true });
    const qr = s.elements.find((e) => e.kind === "qr");
    expect(qr && qr.kind === "qr" && qr.value).toBe("{Name}");
  });
  it("omits the QR when qr is false", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: false });
    expect(s.elements.some((e) => e.kind === "qr")).toBe(false);
  });
  it("exposes name (and code when the qr uses it) as fields", () => {
    const s = ticketSpec({ ...base, layout: "classic", qr: true });
    expect(deriveFields(s)).toContain("Name");
    expect(deriveFields(s)).toContain("Code");
  });
  it("lists two layouts", () => {
    expect(TICKET_LAYOUTS.map((l) => l.id)).toEqual(["classic", "minimal"]);
  });
});
