import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Real sqlite db in a temp dir; @/lib/db opens EE_DB_PATH lazily so setting it
// before the first request is enough.
const tmp = mkdtempSync(resolve(tmpdir(), "runsroute-"));
process.env.EE_DB_PATH = resolve(tmp, "app.db");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { openDb } from "@event-editor/core/db";
import { runMigrations } from "@event-editor/core/migrate";
import { createToolRun } from "@event-editor/core/tool-runs";
import { getDb } from "@/lib/db";
import { GET } from "@/app/api/runs/[tool]/route";
import { DELETE } from "@/app/api/runs/[tool]/[id]/route";

runMigrations(openDb(process.env.EE_DB_PATH));

const req = new Request("http://x/api/runs/pdf");
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as any;

describe("GET /api/runs/[tool]", () => {
  it("400s on a tool outside the whitelist", async () => {
    for (const tool of ["heic", "slice", "qr", "../etc", ""]) {
      const res = await GET(req, params({ tool }));
      expect(res.status).toBe(400);
    }
  });

  it("returns an empty list for a valid tool with no runs", async () => {
    const res = await GET(req, params({ tool: "video" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [] });
  });

  it("lists recorded runs newest first with parsed outputs", async () => {
    const db = getDb();
    const a = createToolRun(db, { tool: "pdf", label: "a.pdf", mode: "merge", outputs: [{ id: "j1", filename: "a-merged.pdf" }] });
    const b = createToolRun(db, { tool: "pdf", label: "b.pdf", mode: "compress", outputs: [{ id: "j2", filename: "b-tidied.pdf" }] });
    createToolRun(db, { tool: "resize", label: "other-tool.png", outputs: [] });

    const res = await GET(req, params({ tool: "pdf" }));
    const body = await res.json();
    expect(body.runs.map((r: { id: string }) => r.id).sort()).toEqual([a, b].sort());
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0].createdAt).toBeGreaterThanOrEqual(body.runs[1].createdAt);
    const merged = body.runs.find((r: { id: string }) => r.id === a);
    expect(merged).toMatchObject({ tool: "pdf", label: "a.pdf", mode: "merge", outputs: [{ id: "j1", filename: "a-merged.pdf" }] });
  });
});

describe("DELETE /api/runs/[tool]/[id]", () => {
  it("400s on a tool outside the whitelist", async () => {
    const res = await DELETE(req, params({ tool: "heic", id: "whatever" }));
    expect(res.status).toBe(400);
  });

  it("deletes a run", async () => {
    const db = getDb();
    const id = createToolRun(db, { tool: "splice", label: "clip.mp4", mode: "trim", outputs: [{ id: "s1", filename: "spliced.mp4" }] });
    const res = await DELETE(req, params({ tool: "splice", id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const after = await (await GET(req, params({ tool: "splice" }))).json();
    expect(after.runs).toEqual([]);
  });

  it("is a no-op ok for an unknown id", async () => {
    const res = await DELETE(req, params({ tool: "convert", id: "nope" }));
    expect(res.status).toBe(200);
  });
});
