export interface RowMatch {
  status: "matched" | "ambiguous" | "unmatched";
  driveFileId?: string;
  candidates?: string[];
}

export function normalizeName(s: string): string {
  return s
    .trim()
    .replace(/\.[a-z0-9]{1,5}$/i, "")        // strip one trailing extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")             // non-alphanumeric runs -> space
    .trim()
    .replace(/\s+/g, " ");
}

const FILE_D = /\/file\/d\/([-\w]{25,})/;
const ID_PARAM = /[?&]id=([-\w]{25,})/;
const BARE_ID = /^[-\w]{25,}$/;

export function extractDriveId(cell: string): string | null {
  const c = cell.trim();
  const m = FILE_D.exec(c) ?? ID_PARAM.exec(c);
  if (m) return m[1];
  if (BARE_ID.test(c)) return c;
  return null;
}

export function matchRow(args: { name: string; photoCell?: string; folderFiles: { id: string; name: string }[] }): RowMatch {
  const cell = args.photoCell?.trim();
  if (cell) {
    const id = extractDriveId(cell);
    if (id) return { status: "matched", driveFileId: id };
  }
  const needle = normalizeName(cell && cell.length ? cell : args.name);
  if (!needle) return { status: "unmatched" };
  const hits = args.folderFiles.filter((f) => normalizeName(f.name) === needle);
  if (hits.length === 1) return { status: "matched", driveFileId: hits[0].id };
  if (hits.length > 1) return { status: "ambiguous", candidates: hits.map((h) => h.id) };
  return { status: "unmatched" };
}
