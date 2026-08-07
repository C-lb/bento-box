import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";

const updateGoogleDoc = vi.fn().mockResolvedValue(undefined);
const writeDocTab = vi.fn().mockResolvedValue({ tabId: "t.new" });
const deleteDocTab = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/google/docs", () => ({
  updateGoogleDoc, writeDocTab, deleteDocTab,
  docTabUrl: (d: string, t: string) => `https://docs.google.com/document/d/${d}/edit?tab=${t}`,
  friendlyDocsError: (e: any) => String(e),
}));
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
// The gdoc path re-reads doc_tab_id from the db inside its critical section,
// so the double has to be stateful: a select that always returns the ORIGINAL
// snapshot would hide exactly the orphaned-tab bug the re-read exists to fix.
function fakeDb(stored: { docTabId: string | null } = { docTabId: null }) {
  const run = vi.fn();
  const where = vi.fn().mockReturnValue({ run });
  const set = vi.fn().mockImplementation((values: any) => {
    if ("docTabId" in values) stored.docTabId = values.docTabId;
    return { where };
  });
  const update = vi.fn().mockReturnValue({ set });
  const selectAll = vi.fn().mockImplementation(() => [{ docTabId: stored.docTabId }]);
  const select = vi.fn().mockReturnValue({
    from: () => ({ where: () => ({ all: selectAll }) }),
  });
  return { db: { update, select } as any, update, set, where, run, select, stored };
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
    const { db } = fakeDb({ docTabId: "t.old" });
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
    const { db } = fakeDb({ docTabId: "t.old" });
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
    const { db, set, where, run } = fakeDb({ docTabId: "t.old" });
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

  it("backfills docId and docUrl, so a row that errored mid-write still links to its tab", async () => {
    // A gdoc row whose initial write failed has docId/docUrl null. Persisting
    // only docTabId would leave the user with a real tab and no way to reach
    // it from the app.
    const { db, set } = fakeDb();
    await syncTranscriptionDoc(db, {
      ...base, docId: null, sourceKind: "gdoc", sourceDocId: "src", docTabId: null,
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      docTabId: "t.new",
      docId: "src",
      docUrl: "https://docs.google.com/document/d/src/edit?tab=t.new",
    }));
  });

  it("serialises two near-simultaneous syncs for one row, leaving exactly one tab", async () => {
    // Blur one draft field straight into another and two /summary saves fire
    // back to back, both holding the same stale docTabId. Unserialised, each
    // writes a tab and each deletes the SAME old one, so the loser's tab is
    // orphaned in the user's document forever.
    const tabs = new Set<string>(["t.old"]);
    let n = 0;
    writeDocTab.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      const id = `t.${++n}`;
      tabs.add(id);
      return { tabId: id };
    });
    deleteDocTab.mockImplementation(async (_d: any, _id: string, tabId: string) => {
      tabs.delete(tabId);
    });

    const { db } = fakeDb({ docTabId: "t.old" });
    const row = { ...base, sourceKind: "gdoc", sourceDocId: "src", docTabId: "t.old" };
    // Same stale snapshot for both, which is what the two route handlers get.
    await Promise.all([syncTranscriptionDoc(db, row), syncTranscriptionDoc(db, { ...row })]);

    expect(writeDocTab).toHaveBeenCalledTimes(2);
    expect(deleteDocTab).toHaveBeenCalledTimes(2);
    // Both ran, and exactly one tab survives: the newest.
    expect([...tabs]).toEqual(["t.2"]);

    writeDocTab.mockReset().mockResolvedValue({ tabId: "t.new" });
    deleteDocTab.mockReset().mockResolvedValue(undefined);
  });
});
