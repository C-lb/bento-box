export type ShortenService = "is.gd" | "v.gd";

export function validateLongUrl(s: string | undefined | null): string | null {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return "Enter a link to shorten.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a valid link.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Links must start with http:// or https://.";
  }
  return null;
}

export function validateCustomName(s: string | undefined | null): string | null {
  if (s === undefined || s === null || s === "") return null;
  if (!/^[A-Za-z0-9_]{5,30}$/.test(s)) {
    return "Custom names must be 5 to 30 characters, letters, numbers, and underscores only.";
  }
  return null;
}

export function buildCreateUrl(service: ShortenService, url: string, custom?: string): string {
  const parts = [`format=json`, `url=${encodeURIComponent(url)}`];
  if (custom) parts.push(`shorturl=${encodeURIComponent(custom)}`);
  return `https://${service}/create.php?${parts.join("&")}`;
}

export const SERVICE_UNAVAILABLE = "The shortening service is unavailable. Try again later.";

const SERVICE_ERRORS: Record<number, string> = {
  1: "That doesn't look like a valid link.",
  2: "That custom name is taken or not allowed. Try another.",
  3: "Rate limit reached. Wait a moment and try again.",
  // is.gd errorcode 4 = "any other error / maintenance", so it shares the
  // service-unavailable message with the network-failure paths.
  4: SERVICE_UNAVAILABLE,
};

export function mapServiceError(errorcode?: number): string {
  if (errorcode !== undefined && SERVICE_ERRORS[errorcode]) return SERVICE_ERRORS[errorcode];
  return SERVICE_UNAVAILABLE;
}
