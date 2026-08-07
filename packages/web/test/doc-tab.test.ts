import { describe, it, expect, vi } from "vitest";
import { writeDocTab, deleteDocTab, docTabUrl, friendlyDocsError } from "@/lib/google/docs";
import type { DocSection } from "@event-editor/core/transcribe";

const sections: DocSection[] = [
  { heading: "Summary", body: { kind: "paras", text: "hello" } },
];

function fakeDocs(addReply: any = { addDocumentTab: { tabProperties: { tabId: "t.new" } } }) {
  const batchUpdate = vi.fn().mockResolvedValue({ data: { replies: [addReply] } });
  return { docs: { documents: { batchUpdate } } as any, batchUpdate };
}

describe("writeDocTab", () => {
  it("adds a tab, reads its id from the reply, then fills it", async () => {
    const { docs, batchUpdate } = fakeDocs();
    const res = await writeDocTab(docs, "doc1", "Summary", sections);

    expect(res.tabId).toBe("t.new");
    expect(batchUpdate).toHaveBeenCalledTimes(2);

    const first = batchUpdate.mock.calls[0][0];
    expect(first.requestBody.requests).toEqual([
      { addDocumentTab: { tabProperties: { title: "Summary" } } },
    ]);

    const second = batchUpdate.mock.calls[1][0];
    expect(second.documentId).toBe("doc1");
    expect(second.requestBody.requests[0].insertText.location.tabId).toBe("t.new");
  });

  it("throws when Docs returns no tab id rather than writing into the wrong tab", async () => {
    const { docs } = fakeDocs({ addDocumentTab: {} });
    await expect(writeDocTab(docs, "doc1", "Summary", sections)).rejects.toThrow(/tab id/i);
  });

  it("bins the empty tab when the fill fails, and surfaces the original error", async () => {
    // The tab was added but its id is never persisted, so nothing will come
    // back for it: leaving it behind strands an empty "Summary" in the user's
    // document.
    const calls: any[] = [];
    const batchUpdate = vi.fn().mockImplementation(async (arg: any) => {
      calls.push(arg.requestBody.requests[0]);
      if (calls.length === 2) throw new Error("fill exploded");
      return { data: { replies: [{ addDocumentTab: { tabProperties: { tabId: "t.new" } } }] } };
    });
    const docs = { documents: { batchUpdate } } as any;

    await expect(writeDocTab(docs, "doc1", "Summary", sections)).rejects.toThrow("fill exploded");
    expect(batchUpdate).toHaveBeenCalledTimes(3);
    expect(calls[2]).toEqual({ deleteTab: { tabId: "t.new" } });
  });

  it("lets the original error through even when the cleanup delete also fails", async () => {
    const batchUpdate = vi
      .fn()
      .mockResolvedValueOnce({ data: { replies: [{ addDocumentTab: { tabProperties: { tabId: "t.new" } } }] } })
      .mockRejectedValueOnce(new Error("fill exploded"))
      .mockRejectedValueOnce(Object.assign(new Error("cleanup exploded"), { code: 500 }));
    const docs = { documents: { batchUpdate } } as any;

    await expect(writeDocTab(docs, "doc1", "Summary", sections)).rejects.toThrow("fill exploded");
  });
});

describe("deleteDocTab", () => {
  it("swallows a 404 so a hand-deleted tab self-heals", async () => {
    const err: any = new Error("not found");
    err.code = 404;
    const docs = { documents: { batchUpdate: vi.fn().mockRejectedValue(err) } } as any;
    await expect(deleteDocTab(docs, "doc1", "t.gone")).resolves.toBeUndefined();
  });

  // The owner's ruling widened this from 404 to 404-or-400: a 400
  // INVALID_ARGUMENT means the id is stale, and a stale id must never block a
  // subsequent write.
  it("swallows a 400 so a stale tab id does not wedge the next write", async () => {
    const err: any = new Error("Invalid tab id");
    err.code = 400;
    const docs = { documents: { batchUpdate: vi.fn().mockRejectedValue(err) } } as any;
    await expect(deleteDocTab(docs, "doc1", "t.stale")).resolves.toBeUndefined();
  });

  it("rethrows anything else", async () => {
    const err: any = new Error("boom");
    err.code = 500;
    const docs = { documents: { batchUpdate: vi.fn().mockRejectedValue(err) } } as any;
    await expect(deleteDocTab(docs, "doc1", "t.x")).rejects.toThrow("boom");
  });
});

describe("docTabUrl", () => {
  it("links straight to the tab", () => {
    expect(docTabUrl("doc1", "t.9")).toBe("https://docs.google.com/document/d/doc1/edit?tab=t.9");
  });
});

describe("friendlyDocsError", () => {
  it("names the scope problem so the user knows to reconnect", () => {
    const err: any = new Error("Request had insufficient authentication scopes.");
    err.code = 403;
    expect(friendlyDocsError(err)).toMatch(/Reconnect Google in Settings/i);
  });

  it("names the permission problem separately", () => {
    const err: any = new Error("The caller does not have permission");
    err.code = 403;
    expect(friendlyDocsError(err)).toMatch(/edit access/i);
  });

  it("passes other messages through", () => {
    expect(friendlyDocsError(new Error("network down"))).toBe("network down");
  });
});
