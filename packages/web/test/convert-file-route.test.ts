import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";

const tmp = mkdtempSync(resolve(tmpdir(), "convroute-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { POST } from "@/app/api/convert/file/route";

function form(file: File, fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("file", file);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x/api/convert/file", { method: "POST", body: fd });
}

describe("POST /api/convert/file", () => {
  it("png + output=jpg returns ext jpg", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const res = await POST(form(new File([png], "a.png", { type: "image/png" }), { output: "jpg" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ext).toBe("jpg");
    expect(body.filename).toBe("a.jpg");
  });

  it("invalid pair (png + output=mp3) returns 400", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const res = await POST(form(new File([png], "a.png", { type: "image/png" }), { output: "mp3" }));
    expect(res.status).toBe(400);
  });
});
