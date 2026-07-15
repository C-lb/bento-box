import {
  Images,
  UserRound,
  Mic,
  Scissors,
  ArrowRightLeft,
  FileImage,
  Shrink,
  Files,
  Film,
  Combine,
  QrCode,
  Eraser,
  Award,
  IdCard,
  Tent,
  Ticket,
  Link,
  Music,
  type LucideIcon,
} from "lucide-react";
import type { ConnectionId } from "@event-editor/core/settings";
import type { DepId } from "@/lib/deps";

export type Tool = {
  id: string;
  href: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  defaultGroups: string[]; // group ids from tool-store DEFAULT_GROUP_ORDER (or custom later)
  tags: string[]; // lowercase, author-defined
  requires?: { keys?: ConnectionId[]; deps?: DepId[] };
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
    requires: { keys: ["google", "anthropic"] },
  },
  {
    id: "studio",
    href: "/studio",
    title: "Build a branded headshot",
    body: "Turn a Drive photo into a clean, on-brand headshot you can download in a click.",
    Icon: UserRound,
    defaultGroups: ["images", "events"],
    tags: ["headshot", "brand", "portrait", "image"],
    requires: { keys: ["google", "canva"] },
  },
  {
    id: "transcribe",
    href: "/transcribe",
    title: "Transcribe to a Google Doc",
    body: "Upload a long recording and get a Doc with a summary and full timestamped transcript.",
    Icon: Mic,
    defaultGroups: ["media", "events"],
    tags: ["transcribe", "audio", "speech", "doc", "subtitle"],
    requires: { keys: ["groq", "anthropic", "google"] },
  },
  {
    id: "slice",
    href: "/slice",
    title: "Slice a deck into PDFs",
    body: "Convert a deck to PDF, split it by page ranges, speaker, or topic, and stamp each page.",
    Icon: Scissors,
    defaultGroups: ["documents"],
    tags: ["pdf", "deck", "slides", "split", "stamp"],
    requires: { keys: ["anthropic"], deps: ["libreoffice"] },
  },
  {
    id: "convert",
    href: "/convert",
    title: "Convert files",
    body: "Change a file's format. Images to png, jpg, webp, or pdf (heic in); pdf to images; audio and video files to mp3, wav, or m4a.",
    Icon: ArrowRightLeft,
    defaultGroups: ["media"],
    tags: ["convert", "image", "png", "jpg", "webp", "pdf", "audio", "mp3", "heic", "pdf to png", "png to pdf", "image converter", "file converter"],
  },
  {
    id: "audio",
    href: "/audio",
    title: "Audio from a link",
    body: "Paste a link, get the audio. Save a talk or video's sound as mp3, wav, or m4a.",
    Icon: Music,
    defaultGroups: ["media"],
    tags: ["audio", "mp3", "wav", "m4a", "youtube", "link", "video", "download", "extract audio"],
    requires: { deps: ["ytdlp"] },
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
    id: "shorten",
    href: "/shorten",
    title: "Shorten a link",
    body: "Turn a long link into a short is.gd one, with an optional custom name.",
    Icon: Link,
    defaultGroups: ["utilities"],
    tags: ["link", "url", "shorten", "short", "qr", "custom"],
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
  {
    id: "badge",
    href: "/badge",
    title: "Make name badges",
    body: "Turn a list into printable name badges, six to a sheet.",
    Icon: IdCard,
    defaultGroups: ["events"],
    tags: ["badge", "name", "lanyard", "merge", "event", "qr"],
  },
  {
    id: "place-card",
    href: "/place-card",
    title: "Make place cards",
    body: "Turn a guest list into printable table place cards.",
    Icon: Tent,
    defaultGroups: ["events"],
    tags: ["place card", "table", "seating", "name", "event"],
  },
  {
    id: "ticket",
    href: "/ticket",
    title: "Make event tickets",
    body: "Turn a list into event tickets, each with its own QR code.",
    Icon: Ticket,
    defaultGroups: ["events"],
    tags: ["ticket", "qr", "admit", "event", "merge"],
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
