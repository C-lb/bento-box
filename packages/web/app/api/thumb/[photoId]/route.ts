import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { photos } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  const row = getDb().select().from(photos).where(eq(photos.id, Number(photoId))).all()[0];
  if (!row?.thumbnailPath) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const bytes = await readFile(resolve(row.thumbnailPath));
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
