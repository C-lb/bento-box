// Persistent history for the background remover. Cut-outs are full-resolution
// PNG blobs (often several MB), far too big for localStorage, so we keep them in
// IndexedDB. Each record is one finished cut-out; the panel lists them newest
// first with a thumbnail, re-download, and delete.

export type CutoutHistoryItem = {
  id: string;
  name: string; // download filename, e.g. "photo-cutout.png"
  at: number; // epoch ms
  blob: Blob; // the exported PNG
};

const DB_NAME = "ee-cutout";
const STORE = "history";
// Cut-outs are full-resolution PNGs (tens of MB each for large photos), so keep
// the ring small to stay well under the IndexedDB quota. addCutoutHistory also
// swallows quota errors, so an over-large write degrades to "not saved" rather
// than breaking the tool.
const MAX_ITEMS = 12;

export function newCutoutId(): string {
  return `co-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Newest first. Pure so it can be unit-tested without IndexedDB. */
export function sortNewestFirst<T extends { at: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.at - a.at);
}

/** The ids to drop so only the newest `max` survive. Pure/testable. */
export function idsToPrune(items: CutoutHistoryItem[], max: number = MAX_ITEMS): string[] {
  return sortNewestFirst(items).slice(max).map((i) => i.id);
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

export async function addCutoutHistory(item: CutoutHistoryItem): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx("readwrite", (s) => s.put(item));
    // Prune oldest beyond the cap.
    const all = await listCutoutHistory();
    for (const id of idsToPrune(all)) await tx("readwrite", (s) => s.delete(id));
  } catch {
    // storage disabled/full: history is best-effort, never block the tool
  }
}

export async function listCutoutHistory(): Promise<CutoutHistoryItem[]> {
  if (!idbAvailable()) return [];
  try {
    const all = await tx<CutoutHistoryItem[]>("readonly", (s) => s.getAll() as IDBRequest<CutoutHistoryItem[]>);
    return sortNewestFirst(all);
  } catch {
    return [];
  }
}

export async function removeCutoutHistory(id: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch {
    // ignore
  }
}

export async function clearCutoutHistory(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await tx("readwrite", (s) => s.clear());
  } catch {
    // ignore
  }
}
