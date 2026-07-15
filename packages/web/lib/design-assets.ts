/** IndexedDB store for F3 design binaries (backgrounds, logos). localStorage
 * can't hold multi-MB images; the JSON design references these by assetId. */
import type { CustomDesign } from "@event-editor/core/custom-design";
import { assetSrc } from "@/lib/custom-upload";

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
      // A transaction can abort (e.g. quota exceeded on a large background
      // upload) without the individual request ever firing onerror, which
      // would otherwise leave this promise pending forever. Settle from
      // whichever fires first; the first settle wins, the rest are no-ops.
      let settled = false;
      const settle = (ok: boolean, value?: T, err?: unknown) => {
        if (settled) return;
        settled = true;
        if (ok) resolve(value as T); else reject(err);
      };
      const tx = db.transaction(STORE, mode);
      tx.onabort = () => settle(false, undefined, tx.error ?? new Error("IndexedDB transaction aborted"));
      tx.onerror = () => settle(false, undefined, tx.error ?? new Error("IndexedDB transaction error"));
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => settle(true, req.result);
      req.onerror = () => settle(false, undefined, req.error);
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

/**
 * Resolves every asset a custom design references (background + image
 * elements) into the renderer's src convention (data URL for images, plain
 * base64 for pdf). Missing assets are simply absent from the returned map;
 * customDesignToSpec drops elements whose asset is missing. Shared by the
 * merge clients' mount hydration and preset apply.
 */
export async function hydrateAssetSrcs(design: CustomDesign): Promise<Record<string, string>> {
  const ids = new Set<string>();
  if (design.background) ids.add(design.background.assetId);
  for (const el of design.elements) if (el.type === "image") ids.add(el.assetId);
  const pairs = await Promise.all(Array.from(ids).map(async (id) => {
    const a = await getAsset(id);
    if (!a) return null;
    const kind = a.mime === "application/pdf" ? "pdf" as const : a.mime === "image/jpeg" ? "jpg" as const : "png" as const;
    return [id, assetSrc(kind, a.bytes)] as const;
  }));
  return Object.fromEntries(pairs.filter((p): p is readonly [string, string] => !!p));
}
