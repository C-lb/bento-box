import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./merge-xlsx";

function csvBuffer(csv: string): ArrayBuffer {
  const wb = XLSX.read(csv, { type: "string" });
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

describe("parseWorkbook", () => {
  it("reads headers and rows from the first sheet", () => {
    const buf = csvBuffer("Name,Org\nAda,Analytical\nGrace,Navy");
    const out = parseWorkbook(buf);
    expect(out.headers).toEqual(["Name", "Org"]);
    expect(out.rows).toEqual([
      { Name: "Ada", Org: "Analytical" },
      { Name: "Grace", Org: "Navy" },
    ]);
  });
  it("fills missing cells with empty strings", () => {
    const buf = csvBuffer("Name,Org\nAda");
    const out = parseWorkbook(buf);
    expect(out.rows[0]).toEqual({ Name: "Ada", Org: "" });
  });
});
