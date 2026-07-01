import { NextResponse } from "next/server";
import { extFromName, stashContext } from "@/lib/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file field required" }, { status: 400 });
  const ext = extFromName(file.name);
  if (!ext) return NextResponse.json({ error: "unsupported context type" }, { status: 400 });
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const contextId = await stashContext(buffer, ext);
    return NextResponse.json({ contextId });
  } catch {
    return NextResponse.json({ error: "could not read the context file" }, { status: 500 });
  }
}
