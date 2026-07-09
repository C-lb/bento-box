export type ShortenHistoryItem = {
  long: string;
  short: string;
  at: number;
};

export type ShortenHistoryState = {
  v: 1;
  items: ShortenHistoryItem[];
};

export const SHORTEN_HISTORY_KEY = "ee.shorten.history";
const MAX_ITEMS = 20;

export function seedShortenHistory(): ShortenHistoryState {
  return { v: 1, items: [] };
}

function isHistoryItem(x: unknown): x is ShortenHistoryItem {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as ShortenHistoryItem).long === "string" &&
    typeof (x as ShortenHistoryItem).short === "string" &&
    typeof (x as ShortenHistoryItem).at === "number"
  );
}

export function parseShortenHistory(raw: string | null): ShortenHistoryState {
  if (!raw) return seedShortenHistory();
  try {
    const p = JSON.parse(raw);
    if (!p || p.v !== 1 || !Array.isArray(p.items)) return seedShortenHistory();
    const items = p.items.filter(isHistoryItem).slice(0, MAX_ITEMS);
    return { v: 1, items };
  } catch {
    return seedShortenHistory();
  }
}

export function addShortenHistoryItem(
  state: ShortenHistoryState,
  item: ShortenHistoryItem,
): ShortenHistoryState {
  return { v: 1, items: [item, ...state.items].slice(0, MAX_ITEMS) };
}

export function readShortenHistory(): ShortenHistoryState {
  if (typeof window === "undefined") return seedShortenHistory();
  return parseShortenHistory(window.localStorage.getItem(SHORTEN_HISTORY_KEY));
}

export function writeShortenHistory(state: ShortenHistoryState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SHORTEN_HISTORY_KEY, JSON.stringify(state));
}

export function clearShortenHistory(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SHORTEN_HISTORY_KEY);
}
