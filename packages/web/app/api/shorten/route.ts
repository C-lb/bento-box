import { NextResponse } from "next/server";
import {
  buildCreateUrl,
  buildTinyurlUrl,
  classifyCreatePhp,
  classifyTinyurl,
  MSG,
  validateCustomName,
  validateLongUrl,
  type ProviderOutcome,
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
  const custom = body.custom;

  // Read a URL as text, or null if the request never got an HTTP response — the
  // one genuine "network" signal (DNS failure, offline, timeout, a filter). A
  // plain User-Agent + JSON Accept keeps Cloudflare from serving a challenge page
  // to Node's header-less default fetch.
  async function fetchText(target: string): Promise<string | null> {
    try {
      const res = await fetch(target, {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "event-editor/shortener", Accept: "application/json" },
      });
      return await res.text();
    } catch {
      return null;
    }
  }

  async function attemptCreatePhp(svc: ShortenService): Promise<ProviderOutcome> {
    const raw = await fetchText(buildCreateUrl(svc, url, custom));
    if (raw === null) return { ok: false, kind: "unreachable", error: MSG.unreachableAll };
    return classifyCreatePhp(raw);
  }

  async function attemptTinyurl(): Promise<ProviderOutcome> {
    const raw = await fetchText(buildTinyurlUrl(url, custom));
    if (raw === null) return { ok: false, kind: "unreachable", error: MSG.unreachableAll };
    return classifyTinyurl(raw, custom);
  }

  // Try the chosen create.php service, its sibling, then TinyURL — which is on
  // separate infrastructure, so it still works when is.gd/v.gd throttle this IP
  // together. A "rejected" outcome (bad/blocked link, taken name) stops early:
  // another provider would refuse the same link, so surface the real reason.
  const createOrder = [
    service as ShortenService,
    ...ALLOWED_SERVICES.filter((s) => s !== service),
  ];
  const attempts: Array<() => Promise<ProviderOutcome>> = [
    ...createOrder.map((svc) => () => attemptCreatePhp(svc)),
    attemptTinyurl,
  ];

  let reachedAny = false;
  for (const attempt of attempts) {
    const out = await attempt();
    if (out.ok) return NextResponse.json({ shorturl: out.shorturl });
    if (out.kind !== "unreachable") reachedAny = true;
    if (out.kind === "rejected") return NextResponse.json({ error: out.error }, { status: 400 });
    // "throttled" or "unreachable" — fall through to the next provider.
  }

  // Every provider failed without a definitive rejection. If any of them actually
  // answered, the network is fine and they're throttling; otherwise it's a true
  // reachability problem.
  return reachedAny
    ? NextResponse.json({ error: MSG.throttledAll }, { status: 503 })
    : NextResponse.json({ error: MSG.unreachableAll }, { status: 502 });
}
