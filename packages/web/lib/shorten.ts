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

/** is.gd / v.gd share the same create.php JSON API. */
export function buildCreateUrl(service: ShortenService, url: string, custom?: string): string {
  const parts = [`format=json`, `url=${encodeURIComponent(url)}`];
  if (custom) parts.push(`shorturl=${encodeURIComponent(custom)}`);
  return `https://${service}/create.php?${parts.join("&")}`;
}

/** TinyURL's create endpoint: a plain GET that returns the short URL as text. */
export function buildTinyurlUrl(url: string, custom?: string): string {
  const parts = [`url=${encodeURIComponent(url)}`];
  if (custom) parts.push(`alias=${encodeURIComponent(custom)}`);
  return `https://tinyurl.com/api-create.php?${parts.join("&")}`;
}

// A single provider attempt resolves to one of three failure kinds so the route
// can react correctly:
//   - "rejected"    the service definitively won't shorten THIS link (bad/blocked
//                   URL, or a taken custom name). Reporting it and stopping is
//                   right — another provider would say the same.
//   - "throttled"   the service was reached but temporarily refused (rate limit,
//                   "database insert failed", maintenance). Worth trying the next
//                   provider, which may be on different infrastructure.
//   - "unreachable" the request never got an HTTP response at all (DNS, offline,
//                   timeout, a network filter). Only this kind means "network".
export type FailKind = "rejected" | "throttled" | "unreachable";
export type ProviderOutcome =
  | { ok: true; shorturl: string }
  | { ok: false; kind: FailKind; error: string };

export const MSG = {
  // Every provider failed, but at least one answered — so the network is fine and
  // the services are throttling. is.gd/v.gd rate-limit per source IP, so a shared
  // office/Wi-Fi address can be tripped by other people on the same connection.
  throttledAll:
    "Every link shortener (is.gd, v.gd, TinyURL) is refusing new links right now. These services rate-limit by network address, so a shared office or Wi-Fi connection can hit the limit from other people's use. Wait a few minutes and try again.",
  // No provider answered at all — this is the only genuine network case.
  unreachableAll:
    "Couldn't reach any link shortener (is.gd, v.gd, TinyURL). Check your internet connection and try again.",
  invalidUrl: "That doesn't look like a valid link.",
  // is.gd errorcode 1 covers both malformed URLs and links it refuses on policy.
  blockedUrl:
    "The shortener won't accept this link. is.gd rejects links that point to another URL shortener, links to sites on its spam/phishing/malware blocklist, and links longer than about 5,000 characters.",
  customTaken: "That custom name is already taken. Try a different one.",
  serviceThrottled: "The shortener is rate-limiting new links right now.",
};

/**
 * Classify an is.gd/v.gd create.php response body (already read as text). This is
 * only ever called when an HTTP response arrived, so it never returns
 * "unreachable" — a non-JSON body means the service answered but isn't giving us
 * a link (its "Error, database insert failed" throttle page is the common one).
 */
export function classifyCreatePhp(rawBody: string): ProviderOutcome {
  let data: { shorturl?: string; errorcode?: number };
  try {
    data = JSON.parse(rawBody);
  } catch {
    return { ok: false, kind: "throttled", error: MSG.serviceThrottled };
  }
  // is.gd error codes: 1 = bad/blocked URL, 2 = custom taken/invalid,
  // 3 = rate limit, 4 = other/maintenance.
  if (data.errorcode === 1) return { ok: false, kind: "rejected", error: MSG.blockedUrl };
  if (data.errorcode === 2) return { ok: false, kind: "rejected", error: MSG.customTaken };
  if (data.errorcode !== undefined) return { ok: false, kind: "throttled", error: MSG.serviceThrottled };
  if (!data.shorturl) return { ok: false, kind: "throttled", error: MSG.serviceThrottled };
  return { ok: true, shorturl: data.shorturl };
}

/**
 * Classify a TinyURL api-create.php response body. Success is the short URL in
 * plain text; anything else is an error string ("Error", or an alias-taken note).
 */
export function classifyTinyurl(rawBody: string, custom?: string): ProviderOutcome {
  const t = rawBody.trim();
  if (/^https?:\/\//i.test(t)) return { ok: true, shorturl: t };
  if (custom) return { ok: false, kind: "rejected", error: MSG.customTaken };
  return { ok: false, kind: "throttled", error: MSG.serviceThrottled };
}

export const SERVICE_UNAVAILABLE = MSG.serviceThrottled;

const SERVICE_ERRORS: Record<number, string> = {
  1: MSG.blockedUrl,
  2: MSG.customTaken,
  3: "Rate limit reached. Wait a moment and try again.",
  4: SERVICE_UNAVAILABLE,
};

export function mapServiceError(errorcode?: number): string {
  if (errorcode !== undefined && SERVICE_ERRORS[errorcode]) return SERVICE_ERRORS[errorcode];
  return SERVICE_UNAVAILABLE;
}
