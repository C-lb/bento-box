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

  const createUrl = buildCreateUrl(service as ShortenService, (body.url ?? "").trim(), body.custom);

  let res: Response;
  try {
    res = await fetch(createUrl, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return NextResponse.json({ error: SERVICE_UNAVAILABLE }, { status: 502 });
  }

  let data: { shorturl?: string; errorcode?: number; errormessage?: string };
  try {
    data = await res.json();
  } catch {
    return NextResponse.json({ error: SERVICE_UNAVAILABLE }, { status: 502 });
  }

  if (data.errorcode !== undefined) {
    return NextResponse.json({ error: mapServiceError(data.errorcode) }, { status: 400 });
  }

  if (!data.shorturl) {
    return NextResponse.json({ error: SERVICE_UNAVAILABLE }, { status: 502 });
  }

  return NextResponse.json({ shorturl: data.shorturl });
}
