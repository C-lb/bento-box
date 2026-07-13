import { NextResponse } from "next/server";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { getDb } from "@/lib/db";

// Folder listing for the FolderPicker.
//   ?parent=root | shared | <folderId>  -> children of that location
//   ?q=<term>                           -> name search across the whole Drive
// No params behaves like ?parent=root.
export async function GET(request: Request) {
  const drive = await authedDriveClient(getDb());
  if (!drive) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const client = makeDriveClient(drive);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();
  const parent = url.searchParams.get("parent") ?? "root";

  try {
    const folders = q
      ? await client.searchFolders(q)
      : parent === "shared"
        ? await client.listSharedFolders()
        : await client.listChildFolders(parent);
    return NextResponse.json({ folders });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "listing failed" }, { status: 500 });
  }
}
