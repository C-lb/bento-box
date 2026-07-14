import { NextResponse } from "next/server";
import {
  buildCreateUrl,
  mapServiceError,
  SERVICE_UNAVAILABLE,
  validateCustomName,
  validateLongUrl,
  type ShortenService,
} from "@/lib/shorten";

export const runtime = "nodejs";

const ALLOWED_SERVICES: ShortenService[] = ["is.gd", "v.gd"];

export async function POST(request: Request) {
  let body: { url?: string; custom?: string; service?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const urlError = validateLongUrl(body.url);
  if (urlError) return NextResponse.json({ error: urlError }, { status: 400 });

  const customError = validateCustomName(body.custom);
  if (customError) return NextResponse.json({ error: customError }, { status: 400 });

  const service = body.service ?? "is.gd";
  if (!ALLOWED_SERVICES.includes(service as ShortenService)) {
    return NextResponse.json({ error: "Unsupported shortening service." }, { status: 400 });
  }
  const url = (body.url ?? "").trim();

  // Try the chosen service, then fall back to the sibling (same API) once, so a
  // transient blip on one still resolves. A `blocked` outcome means the request
  // never reached the service (offline, or a network that filters shorteners) —
  // that is distinct from the service answering with an error code.
  type Outcome =
    | { ok: true; shorturl: string }
    | { ok: false; error: string; status: number; blocked: boolean };

  async function attempt(svc: ShortenService): Promise<Outcome> {
    let res: Response;
    try {
      res = await fetch(buildCreateUrl(svc, url, body.custom), { signal: AbortSignal.timeout(10_000) });
    } catch {
      // Never reached the host: DNS failure, timeout, offline, or a filter.
      return { ok: false, error: SERVICE_UNAVAILABLE, status: 502, blocked: true };
    }
    let data: { shorturl?: string; errorcode?: number };
    try {
      data = await res.json();
    } catch {
      // Reached something, but not the JSON API (e.g. a block page or 5xx html).
      return { ok: false, error: SERVICE_UNAVAILABLE, status: 502, blocked: true };
    }
    if (data.errorcode !== undefined) {
      return { ok: false, error: mapServiceError(data.errorcode), status: 400, blocked: false };
    }
    if (!data.shorturl) return { ok: false, error: SERVICE_UNAVAILABLE, status: 502, blocked: true };
    return { ok: true, shorturl: data.shorturl };
  }

  const order = [service as ShortenService, ...ALLOWED_SERVICES.filter((s) => s !== service)];
  let last: Outcome | null = null;
  for (const svc of order) {
    const out = await attempt(svc);
    if (out.ok) return NextResponse.json({ shorturl: out.shorturl });
    last = out;
    // A real service error (bad url, taken name, rate limit) won't differ across
    // siblings, so stop and report it. Only fall back on a blocked/unreachable.
    if (!out.blocked) break;
  }

  const failure = last ?? { error: SERVICE_UNAVAILABLE, status: 502, blocked: true };
  const error = failure.blocked
    ? "Could not reach the link shortener. Your network or DNS may be blocking is.gd and v.gd, which some networks filter as URL shorteners."
    : failure.error;
  return NextResponse.json({ error }, { status: failure.status });
}
