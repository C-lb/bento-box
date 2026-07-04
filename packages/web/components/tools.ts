import {
  Images,
  UserRound,
  Mic,
  Scissors,
  AudioLines,
  FileImage,
  Shrink,
  Files,
  Film,
  Combine,
  QrCode,
  Eraser,
  Award,
  type LucideIcon,
} from "lucide-react";

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
  {
    id: "heic",
    href: "/heic",
    title: "Convert HEIC photos",
    body: "Turn iPhone .heic photos into jpg or png you can use anywhere.",
    Icon: FileImage,
    defaultGroups: ["images"],
    tags: ["heic", "iphone", "jpg", "png", "photo", "image"],
  },
  {
    id: "resize",
    href: "/resize",
    title: "Compress or resize images",
    body: "Shrink an image's dimensions or file size, and change its format.",
    Icon: Shrink,
    defaultGroups: ["images"],
    tags: ["resize", "compress", "image", "shrink", "webp"],
  },
  {
    id: "pdf",
    href: "/pdf",
    title: "Merge, split, or shrink PDFs",
    body: "Combine PDFs, split one by page ranges, or tidy a bloated file.",
    Icon: Files,
    defaultGroups: ["documents"],
    tags: ["pdf", "merge", "split", "compress", "combine"],
  },
  {
    id: "video",
    href: "/video",
    title: "Compress a video",
    body: "Re-encode a video smaller with a simple quality preset.",
    Icon: Film,
    defaultGroups: ["media"],
    tags: ["video", "compress", "mp4", "shrink"],
  },
  {
    id: "splice",
    href: "/splice",
    title: "Trim and join clips",
    body: "Trim, reorder, and join video or audio clips into one file.",
    Icon: Combine,
    defaultGroups: ["media"],
    tags: ["video", "audio", "trim", "join", "concat", "edit"],
  },
  {
    id: "qr",
    href: "/qr",
    title: "Make a QR code",
    body: "Turn a link or text into a QR code you can download as png or svg.",
    Icon: QrCode,
    defaultGroups: ["utilities"],
    tags: ["qr", "code", "link", "url"],
  },
  {
    id: "cutout",
    href: "/cutout",
    title: "Remove a background",
    body: "Cut a person out of a photo onto a transparent or solid background.",
    Icon: Eraser,
    defaultGroups: ["images"],
    tags: ["background", "remove", "cutout", "transparent", "png", "person", "photo"],
  },
  {
    id: "certificate",
    href: "/certificate",
    title: "Make certificates",
    body: "Turn a list of names into personalised, print-ready certificates.",
    Icon: Award,
    defaultGroups: ["events", "documents"],
    tags: ["certificate", "award", "merge", "names", "event", "pdf"],
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
