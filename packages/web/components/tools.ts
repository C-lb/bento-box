import { Images, UserRound, Mic, Scissors, AudioLines, type LucideIcon } from "lucide-react";

export type Tool = {
  id: string;
  href: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  defaultGroups: string[]; // group ids from tool-store DEFAULT_GROUP_ORDER (or custom later)
  tags: string[]; // lowercase, author-defined
};

export const TOOLS: Tool[] = [
  {
    id: "sorter",
    href: "/sorter",
    title: "Rank Drive photos",
    body: "Scan a Google Drive folder and rank each photo for headshot fitness, best first.",
    Icon: Images,
    defaultGroups: ["images", "events"],
    tags: ["rank", "drive", "headshot", "photo", "image"],
  },
  {
    id: "studio",
    href: "/studio",
    title: "Build a branded headshot",
    body: "Turn a Drive photo into a clean, on-brand headshot you can download in a click.",
    Icon: UserRound,
    defaultGroups: ["images", "events"],
    tags: ["headshot", "brand", "portrait", "image"],
  },
  {
    id: "transcribe",
    href: "/transcribe",
    title: "Transcribe to a Google Doc",
    body: "Upload a long recording and get a Doc with a summary and full timestamped transcript.",
    Icon: Mic,
    defaultGroups: ["media", "events"],
    tags: ["transcribe", "audio", "speech", "doc", "subtitle"],
  },
  {
    id: "slice",
    href: "/slice",
    title: "Slice a deck into PDFs",
    body: "Convert a deck to PDF, split it by page ranges, speaker, or topic, and stamp each page.",
    Icon: Scissors,
    defaultGroups: ["documents"],
    tags: ["pdf", "deck", "slides", "split", "stamp"],
  },
  {
    id: "convert",
    href: "/convert",
    title: "Convert audio to mp3",
    body: "Turn a YouTube or video link, or an uploaded audio or video file, into an mp3 you can name and download.",
    Icon: AudioLines,
    defaultGroups: ["media"],
    tags: ["audio", "mp3", "convert", "youtube", "video"],
  },
];

export function toolById(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function searchTools(tools: Tool[], query: string): Tool[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  return tools.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q)),
  );
}
