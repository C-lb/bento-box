// Persistent history for the merge tools (badge, certificate, place card,
// ticket). Outputs are PDF/zip blobs, far too big for localStorage, so they
// live in IndexedDB. One db, one store, records scoped per tool via the
// `tool` field; the panel lists a tool's items newest first with re-download
// and delete. Mirrors lib/cutout-history.ts.

export type BlobHistoryItem = {
  id: string;
  tool: string; // owning tool id, e.g. "badge"
  filename: string; // the exact filename the download used, e.g. "badges.pdf"
  at: number; // epoch ms
  blob: Blob; // the exported PDF or zip
};

const DB_NAME = "ee-merge";
const STORE = "history";
// Merge outputs can be big (a zip of hundreds of PDFs), so keep the per-tool
// ring small to stay well under the IndexedDB quota. addBlobHistory also
// swallows quota errors, so an over-large write degrades to "not saved"
// rather than breaking the tool.
const MAX_ITEMS = 6;
// Anything larger is skipped outright (silent no-op) — the download the user
// just made still happened; only the history copy is dropped.
const MAX_BLOB_BYTES = 50 * 1024 * 1024;

export function newBlobHistoryId(): string {
  return `mh-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Newest first. Pure so it can be unit-tested without IndexedDB. */
export function sortNewestFirst<T extends { at: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.at - a.at);
}

/** True when a blob is too large to keep in history. Pure/testable. */
export function exceedsSizeLimit(bytes: number, max: number = MAX_BLOB_BYTES): boolean {
  return bytes > max;
}

/** The ids belonging to one tool (what "Clear all" deletes). Pure/testable. */
export function idsForTool(items: BlobHistoryItem[], tool: string): string[] {
  return items.filter((i) => i.tool === tool).map((i) => i.id);
}

/**
 * The ids to drop so only the newest `max` items of `tool` survive. Other
 * tools' items are never pruned by this tool's writes. Pure/testable.
 */
export function idsToPrune(items: BlobHistoryItem[], tool: string, max: number = MAX_ITEMS): string[] {
  return sortNewestFirst(items.filter((i) => i.tool === tool))
    .slice(max)
    .map((i) => i.id);
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

async function listAll(): Promise<BlobHistoryItem[]> {
  return tx<BlobHistoryItem[]>("readonly", (s) => s.getAll() as IDBRequest<BlobHistoryItem[]>);
}

export async function addBlobHistory(item: BlobHistoryItem): Promise<void> {
  if (!idbAvailable()) return;
  if (exceedsSizeLimit(item.blob.size)) return; // silent: the download itself already happened
  try {
    await tx("readwrite", (s) => s.put(item));
    // Prune this tool's oldest beyond the cap.
    const all = await listAll();
    for (const id of idsToPrune(all, item.tool)) await tx("readwrite", (s) => s.delete(id));
  } catch {
    // storage disabled/full: history is best-effort, never block the tool
  }
}

export async function listBlobHistory(tool: string): Promise<BlobHistoryItem[]> {
  if (!idbAvailable()) return [];
  try {
    const all = await listAll();
    return sortNewestFirst(all.filter((i) => i.tool === tool));
  } catch {
    return [];
  }
}

export async function removeBlobHistory(id: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    // ignore
  }
}

/** Clears one tool's history only; other tools' items survive. */
export async function clearBlobHistory(tool: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const all = await listAll();
    for (const id of idsForTool(all, tool)) await tx("readwrite", (s) => s.delete(id));
  } catch {
    // ignore
  }
}
