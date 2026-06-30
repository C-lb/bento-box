const SYNONYMS: Record<"name" | "title" | "photo", string[]> = {
  name: ["name", "full name"],
  title: ["title", "role", "position", "job title"],
  photo: ["photo", "image", "headshot", "picture"],
};

export function detectColumns(header: string[]): { name: number | null; title: number | null; photo: number | null } {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (field: "name" | "title" | "photo") => {
    const idx = norm.findIndex((h) => SYNONYMS[field].includes(h));
    return idx === -1 ? null : idx;
  };
  return { name: find("name"), title: find("title"), photo: find("photo") };
}
