/** IndexedDB store for F3 design binaries (backgrounds, logos). localStorage
 * can't hold multi-MB images; the JSON design references these by assetId. */

const DB_NAME = "ee-design-assets";
const STORE = "assets";

function openDb(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putAsset(id: string, bytes: Uint8Array, mime: string): Promise<void> {
  await withStore("readwrite", (s) => s.put({ bytes, mime }, id));
}

export async function getAsset(id: string): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  const v = await withStore<{ bytes: Uint8Array; mime: string } | undefined>("readonly", (s) => s.get(id) as IDBRequest<{ bytes: Uint8Array; mime: string } | undefined>);
  return v ?? undefined;
}

export async function deleteAsset(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}
