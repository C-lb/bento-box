// packages/web/test/canva-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeCanvaClient } from "../lib/canva/client";
import { saveToken } from "@event-editor/core/tokens";
import { refreshToken } from "../lib/canva/oauth";

function fakeDb() {
  return {} as any; // token accessor is stubbed via the token module mock below
}

vi.mock("@event-editor/core/tokens", () => ({
  getToken: () => ({ provider: "canva", accessToken: "at", refreshToken: "rt", expiryMs: null, scope: null }),
  saveToken: vi.fn(),
}));

vi.mock("../lib/canva/oauth", async (importActual) => {
  const actual = await importActual<typeof import("../lib/canva/oauth")>();
  return {
    ...actual,
    refreshToken: vi.fn().mockResolvedValue({ accessToken: "new-at", refreshToken: "new-rt", expiryMs: null, scope: null }),
  };
});

function jsonRes(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("canva client", () => {
  it("lists brand templates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes({ items: [{ id: "t1", title: "Speaker" }] })) as any);
    const out = await makeCanvaClient(fakeDb()).listBrandTemplates();
    expect(out).toEqual([{ id: "t1", title: "Speaker" }]);
  });

  it("polls an autofill job to a design id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ job: { id: "j1", status: "in_progress" } }))   // POST create
      .mockResolvedValueOnce(jsonRes({ job: { id: "j1", status: "in_progress" } }))   // GET poll
      .mockResolvedValueOnce(jsonRes({ job: { id: "j1", status: "success", result: { design: { id: "d9" } } } }));
    vi.stubGlobal("fetch", fetchMock as any);
    const id = await makeCanvaClient(fakeDb()).createAutofill("t1", {
      name: { type: "text", text: "Ada" },
    });
    expect(id).toBe("d9");
  });

  it("throws CanvaError on a failed export job", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ job: { id: "e1", status: "in_progress" } }))
      .mockResolvedValueOnce(jsonRes({ job: { id: "e1", status: "failed", error: { message: "no access" } } }));
    vi.stubGlobal("fetch", fetchMock as any);
    await expect(makeCanvaClient(fakeDb()).exportPng("d9")).rejects.toThrow(/no access/);
  });

  it("refreshes token on 401 and retries successfully", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({}, 401))
      .mockResolvedValueOnce(jsonRes({ items: [{ id: "t2", title: "Host" }] }));
    vi.stubGlobal("fetch", fetchMock as any);
    const out = await makeCanvaClient(fakeDb()).listBrandTemplates();
    expect(out).toEqual([{ id: "t2", title: "Host" }]);
    expect(refreshToken).toHaveBeenCalledWith("rt");
    expect(saveToken).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
