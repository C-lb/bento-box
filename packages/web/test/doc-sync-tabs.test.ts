import { describe, it, expect, vi, beforeEach } from "vitest";

const updateGoogleDoc = vi.fn().mockResolvedValue(undefined);
const writeDocTab = vi.fn().mockResolvedValue({ tabId: "t.new" });
const deleteDocTab = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/google/docs", () => ({ updateGoogleDoc, writeDocTab, deleteDocTab, docTabUrl: () => "u", friendlyDocsError: (e: any) => String(e) }));
vi.mock("@/lib/google/oauth", () => ({
  authedDriveClient: async () => ({}),
  authedDocsClient: async () => ({}),
}));

const { syncTranscriptionDoc } = await import("@/lib/doc-sync");

const base = {
  id: 7, docId: "doc1", summaryText: "s", transcriptText: "t", transcriptSegments: null,
  summaryLinkedin: "post", summaryArticle: null,
  sourceKind: null as string | null, sourceDocId: null as string | null, docTabId: null as string | null,
};

function fakeDb() {
  const set = vi.fn().mockReturnValue({ where: () => ({ run: () => {} }) });
  return { db: { update: () => ({ set }) } as any, set };
}

beforeEach(() => { updateGoogleDoc.mockClear(); writeDocTab.mockClear(); deleteDocTab.mockClear(); });

describe("syncTranscriptionDoc", () => {
  it("re-imports HTML for an audio row, as before", async () => {
    expect(await syncTranscriptionDoc({} as any, { ...base })).toBe(true);
    expect(updateGoogleDoc).toHaveBeenCalledOnce();
    expect(writeDocTab).not.toHaveBeenCalled();
  });

  it("NEVER whole-file re-imports a gdoc row, because that destroys the original", async () => {
    await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(updateGoogleDoc).not.toHaveBeenCalled();
  });

  it("replaces the tab: delete the old one, write a fresh one", async () => {
    const ok = await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(ok).toBe(true);
    expect(deleteDocTab).toHaveBeenCalledWith(expect.anything(), "src", "t.old");
    expect(writeDocTab).toHaveBeenCalledOnce();
  });

  it("writes a fresh tab when we never had one", async () => {
    await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: null,
    });
    expect(deleteDocTab).not.toHaveBeenCalled();
    expect(writeDocTab).toHaveBeenCalledOnce();
  });

  it("sends no source section into a gdoc tab", async () => {
    await syncTranscriptionDoc({} as any, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: null,
    });
    const sections = writeDocTab.mock.calls[0][3];
    expect(sections.map((s: any) => s.heading)).toEqual(["Summary", "LinkedIn post"]);
  });

  it("writes the new tab id back, or the next sync deletes a tab that is gone", async () => {
    const { db, set } = fakeDb();
    await syncTranscriptionDoc(db, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ docTabId: "t.new" }));
  });
});
