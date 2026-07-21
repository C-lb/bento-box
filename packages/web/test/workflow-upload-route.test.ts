import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const tmp = mkdtempSync(resolve(tmpdir(), "wfupload-"));
process.env.EE_DATA_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { POST } from "@/app/api/workflow/upload/route";

describe("POST /api/workflow/upload", () => {
  it("stores the upload and returns a FileRef shape ({path, filename})", async () => {
    const fd = new FormData();
    fd.set("file", new File([Buffer.from("hello")], "photo.png", { type: "image/png" }));
    const res = await POST(new Request("http://x/api/workflow/upload", { method: "POST", body: fd }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.filename).toBe("photo.png");
    expect(typeof body.path).toBe("string");
    expect(readFileSync(body.path, "utf8")).toBe("hello");
  });

  it("400s when no file is provided", async () => {
    const fd = new FormData();
    const res = await POST(new Request("http://x/api/workflow/upload", { method: "POST", body: fd }));
    expect(res.status).toBe(400);
  });
});
