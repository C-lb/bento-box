import { describe, it, expect, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const tmp = mkdtempSync(resolve(tmpdir(), "wfroute-"));
process.env.EE_DB_PATH = resolve(tmp, "app.db");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

import { openDb } from "@event-editor/core/db";
import { runMigrations } from "@event-editor/core/migrate";
runMigrations(openDb(process.env.EE_DB_PATH));

vi.mock("../lib/workflow/plan.js", () => ({
  proposeChain: vi.fn(async () => [{ toolId: "resize", instructionText: "shrink to 800px" }]),
  synthesizeParams: vi.fn(async () => ({ maxW: 800, maxH: null, format: "jpeg", quality: 80 })),
}));

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as any;

describe("POST /api/workflow/propose", () => {
  it("returns synthesized steps for a goal", async () => {
    const { POST } = await import("../app/api/workflow/propose/route.js");
    const req = new Request("http://x/api/workflow/propose", { method: "POST", body: JSON.stringify({ goal: "shrink a photo" }) });
    const res = await POST(req);
    const body = await res.json();
    expect(body.steps).toEqual([{ toolId: "resize", instructionText: "shrink to 800px", params: { maxW: 800, maxH: null, format: "jpeg", quality: 80 } }]);
  });

  it("400s on a missing goal", async () => {
    const { POST } = await import("../app/api/workflow/propose/route.js");
    const req = new Request("http://x/api/workflow/propose", { method: "POST", body: JSON.stringify({}) });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("workflow CRUD routes", () => {
  it("saves, lists, fetches, updates, and deletes a workflow", async () => {
    const { POST, GET } = await import("../app/api/workflow/route.js");
    const createRes = await POST(
      new Request("http://x/api/workflow", { method: "POST", body: JSON.stringify({ name: "Resize batch", steps: [{ toolId: "resize", params: { maxW: 800 } }] }) }),
    );
    const { id } = await createRes.json();
    expect(id).toBeTruthy();

    const listRes = await GET();
    const { workflows } = await listRes.json();
    expect(workflows.some((w: any) => w.id === id)).toBe(true);

    const { GET: GET_ONE, PATCH, DELETE } = await import("../app/api/workflow/[id]/route.js");
    const oneRes = await GET_ONE(new Request("http://x"), params({ id }));
    expect((await oneRes.json()).workflow.name).toBe("Resize batch");

    const patchRes = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }), params({ id }));
    expect(patchRes.status).toBe(200);

    const afterPatch = await GET_ONE(new Request("http://x"), params({ id }));
    expect((await afterPatch.json()).workflow.name).toBe("Renamed");

    const delRes = await DELETE(new Request("http://x", { method: "DELETE" }), params({ id }));
    expect(delRes.status).toBe(200);
    const missing = await GET_ONE(new Request("http://x"), params({ id }));
    expect(missing.status).toBe(404);
  });
});

describe("run + poll + retry routes", () => {
  it("starts a run and the run is pollable", async () => {
    vi.mock("../lib/workflow/engine.js", () => ({
      runWorkflow: vi.fn(async () => {}),
      retryWorkflowFrom: vi.fn(async () => {}),
    }));
    const { POST: SAVE } = await import("../app/api/workflow/route.js");
    const saveRes = await SAVE(
      new Request("http://x/api/workflow", { method: "POST", body: JSON.stringify({ name: "R", steps: [{ toolId: "resize", params: {} }] }) }),
    );
    const { id } = await saveRes.json();

    const { POST: RUN } = await import("../app/api/workflow/[id]/run/route.js");
    const runRes = await RUN(new Request("http://x", { method: "POST", body: JSON.stringify({ firstInput: { path: "/x", filename: "a.png" } }) }), params({ id }));
    const { runId } = await runRes.json();
    expect(runId).toBeTruthy();

    const { GET: GET_RUN } = await import("../app/api/workflow/runs/[runId]/route.js");
    const pollRes = await GET_RUN(new Request("http://x"), params({ runId }));
    expect((await pollRes.json()).run.id).toBe(runId);
  });
});
