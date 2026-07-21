import { NextResponse } from "next/server";
import { normalizeQrOpts } from "@event-editor/core/qr";
import { generateQrBuffer } from "@/lib/qr-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  const opts = normalizeQrOpts(body ?? {});
  try {
    const buf = await generateQrBuffer(text, opts);
    return new NextResponse(buf, {
      headers: { "Content-Type": opts.format === "svg" ? "image/svg+xml" : "image/png" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
