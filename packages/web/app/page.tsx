import { ToolCard } from "@/components/ToolCard";
import { SorterIllus, StudioIllus, TranscribeIllus, SliceIllus } from "@/components/tool-illustrations";
import { Images, Star, ArrowDownUp, UserRound, Crop, Download, Mic, AudioLines, FileText, Layers, Scissors, Shield } from "lucide-react";

const TOOLS = [
  {
    href: "/sorter",
    title: "Rank Drive photos",
    body: "Scan a Google Drive folder and rank each photo for headshot fitness, best first.",
    illustration: <SorterIllus />,
    icons: [Images, Star, ArrowDownUp],
  },
  {
    href: "/studio",
    title: "Build a branded headshot",
    body: "Turn a Drive photo into a clean, on-brand headshot you can download in a click.",
    illustration: <StudioIllus />,
    icons: [UserRound, Crop, Download],
  },
  {
    href: "/transcribe",
    title: "Transcribe to a Google Doc",
    body: "Upload a long recording and get a Doc with a summary and full timestamped transcript.",
    illustration: <TranscribeIllus />,
    icons: [Mic, AudioLines, FileText],
  },
  {
    href: "/slice",
    title: "Slice a deck into PDFs",
    body: "Convert a deck to PDF, split it by page ranges, speaker, or topic, and stamp each page.",
    illustration: <SliceIllus />,
    icons: [Layers, Scissors, Shield],
  },
];

export default function Home() {
  return (
    <div className="-mx-6 overflow-x-auto px-6 [scrollbar-width:thin]">
      <div className="flex snap-x snap-mandatory gap-5 pb-2">
        {TOOLS.map((t) => (
          <ToolCard key={t.href} href={t.href} title={t.title} body={t.body} illustration={t.illustration} icons={t.icons} />
        ))}
      </div>
    </div>
  );
}
