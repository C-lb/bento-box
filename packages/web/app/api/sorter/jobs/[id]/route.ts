import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { jobs, photos } from "@event-editor/core/schema";
import { getDb } from "@/lib/db";
import { thumbsDir } from "@/lib/paths";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  const job = db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0];
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rows = db.select().from(photos).where(eq(photos.jobId, jobId)).all();
  return NextResponse.json({ job, photos: rows });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const db = getDb();
  db.delete(photos).where(eq(photos.jobId, jobId)).run();
  db.delete(jobs).where(eq(jobs.id, jobId)).run();
  await rm(resolve(thumbsDir(), String(jobId)), { recursive: true, force: true }).catch(() => {});
  return NextResponse.json({ ok: true });
}
