import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";

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

// The persist step (db.update(...).set(...).where(...).run()) is no longer
// best-effort: it must actually succeed for a gdoc sync to report true, and a
// real failure there must propagate to `false`. So every gdoc-path test needs
// a double with a working update/set/where/run chain, not a bare `{}`.
function fakeDb() {
  const run = vi.fn();
  const where = vi.fn().mockReturnValue({ run });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { db: { update } as any, update, set, where, run };
}

beforeEach(() => { updateGoogleDoc.mockClear(); writeDocTab.mockClear(); deleteDocTab.mockClear(); });

describe("syncTranscriptionDoc", () => {
  it("re-imports HTML for an audio row, as before", async () => {
    // Audio rows never touch db.update, so the bare object is fine here.
    expect(await syncTranscriptionDoc({} as any, { ...base })).toBe(true);
    expect(updateGoogleDoc).toHaveBeenCalledOnce();
    expect(writeDocTab).not.toHaveBeenCalled();
  });

  it("NEVER whole-file re-imports a gdoc row, because that destroys the original", async () => {
    const { db } = fakeDb();
    await syncTranscriptionDoc(db, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(updateGoogleDoc).not.toHaveBeenCalled();
  });

  it("refuses updateGoogleDoc when docId equals sourceDocId, even if sourceKind lies", async () => {
    // A tab-backed row's docId always equals its sourceDocId. If sourceKind
    // were ever wrong (bad migration, backfill, manual edit) but that
    // equality still holds, updateGoogleDoc must still be unreachable —
    // routing on sourceKind alone would re-arm the whole-file data loss.
    const { db } = fakeDb();
    const ok = await syncTranscriptionDoc(db, {
      ...base, sourceKind: "audio", docId: "same", sourceDocId: "same", docTabId: null,
    });
    expect(updateGoogleDoc).not.toHaveBeenCalled();
    expect(ok).toBe(true);
    expect(writeDocTab).toHaveBeenCalledOnce();
  });

  it("replaces the tab: write the fresh one, then delete the old one", async () => {
    const { db } = fakeDb();
    const ok = await syncTranscriptionDoc(db, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(ok).toBe(true);
    expect(deleteDocTab).toHaveBeenCalledWith(expect.anything(), "src", "t.old");
    expect(writeDocTab).toHaveBeenCalledOnce();
    // Order matters (repo owner's ruling): write-then-persist-then-delete, so
    // that a lost persist still leaves the row pointing at a tab that exists.
    const writeOrder = writeDocTab.mock.invocationCallOrder[0];
    const deleteOrder = deleteDocTab.mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(deleteOrder);
  });

  it("writes a fresh tab when we never had one", async () => {
    const { db } = fakeDb();
    await syncTranscriptionDoc(db, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: null,
    });
    expect(deleteDocTab).not.toHaveBeenCalled();
    expect(writeDocTab).toHaveBeenCalledOnce();
  });

  it("sends no source section into a gdoc tab", async () => {
    const { db } = fakeDb();
    await syncTranscriptionDoc(db, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: null,
    });
    const sections = writeDocTab.mock.calls[0][3];
    expect(sections.map((s: any) => s.heading)).toEqual(["Summary", "LinkedIn post"]);
  });

  it("writes the new tab id back to the right row, and actually persists it", async () => {
    const { db, set, where, run } = fakeDb();
    const ok = await syncTranscriptionDoc(db, {
      ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old",
    });
    expect(ok).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ docTabId: "t.new" }));
    // A drizzle builder is lazy until .run() is called: without this
    // assertion, deleting the .run() call leaves the test green while nothing
    // is ever persisted.
    expect(run).toHaveBeenCalledOnce();
    // Without this, a write-back aimed at the wrong row would also pass.
    expect(where).toHaveBeenCalledWith(eq(transcriptions.id, base.id));
  });
});
