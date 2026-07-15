import type { QrEcc, QrFormat } from "@event-editor/core/qr";

export type QrHistoryItem = {
  id: string;
  text: string;
  at: number;
  // Options needed to regenerate the exact same code from the form.
  size: number;
  ecc: QrEcc;
  fg: string;
  bg: string;
  format: QrFormat;
};

export type QrHistoryState = {
  v: 1;
  items: QrHistoryItem[];
};

export const QR_HISTORY_KEY = "ee.qr.history";
const MAX_ITEMS = 20;

const ECCS: readonly string[] = ["L", "M", "Q", "H"];
const FORMATS: readonly string[] = ["png", "svg"];

export function seedQrHistory(): QrHistoryState {
  return { v: 1, items: [] };
}

export function newQrHistoryId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function isHistoryItem(x: unknown): x is QrHistoryItem {
  if (!x || typeof x !== "object") return false;
  const it = x as QrHistoryItem;
  return (
    typeof it.id === "string" &&
    typeof it.text === "string" &&
    typeof it.at === "number" &&
    typeof it.size === "number" &&
    ECCS.includes(it.ecc) &&
    typeof it.fg === "string" &&
    typeof it.bg === "string" &&
    FORMATS.includes(it.format)
  );
}

export function parseQrHistory(raw: string | null): QrHistoryState {
  if (!raw) return seedQrHistory();
  try {
    const p = JSON.parse(raw);
    if (!p || p.v !== 1 || !Array.isArray(p.items)) return seedQrHistory();
    const items = p.items.filter(isHistoryItem).slice(0, MAX_ITEMS);
    return { v: 1, items };
  } catch {
    return seedQrHistory();
  }
}

/** Same code as the top entry (ignoring id/timestamp)? Then don't stack a duplicate. */
function sameAsHead(state: QrHistoryState, item: QrHistoryItem): boolean {
  const head = state.items[0];
  return (
    !!head &&
    head.text === item.text &&
    head.size === item.size &&
    head.ecc === item.ecc &&
    head.fg === item.fg &&
    head.bg === item.bg &&
    head.format === item.format
  );
}

export function addQrHistoryItem(state: QrHistoryState, item: QrHistoryItem): QrHistoryState {
  // Consecutive-duplicate dedupe: re-downloading the same code just refreshes
  // the top entry instead of filling the list with copies.
  const rest = sameAsHead(state, item) ? state.items.slice(1) : state.items;
  return { v: 1, items: [item, ...rest].slice(0, MAX_ITEMS) };
}

export function removeQrHistoryItem(state: QrHistoryState, id: string): QrHistoryState {
  return { v: 1, items: state.items.filter((it) => it.id !== id) };
}

export function readQrHistory(): QrHistoryState {
  if (typeof window === "undefined") return seedQrHistory();
  return parseQrHistory(window.localStorage.getItem(QR_HISTORY_KEY));
}

export function writeQrHistory(state: QrHistoryState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QR_HISTORY_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or storage disabled (e.g. Safari lockdown mode): drop silently
  }
}

export function clearQrHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(QR_HISTORY_KEY);
  } catch {
    // storage disabled: nothing to clean up
  }
}
