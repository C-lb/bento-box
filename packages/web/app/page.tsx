import { ToolCard } from "@/components/ToolCard";
import { SorterIllus, StudioIllus, TranscribeIllus, SliceIllus, ConvertIllus } from "@/components/tool-illustrations";
import { Images, UserRound, Mic, Scissors, AudioLines } from "lucide-react";

const TOOLS = [
  {
    href: "/sorter",
    title: "Rank Drive photos",
    body: "Scan a Google Drive folder and rank each photo for headshot fitness, best first.",
    illustration: <SorterIllus />,
    Icon: Images,
  },
  {
    href: "/studio",
    title: "Build a branded headshot",
    body: "Turn a Drive photo into a clean, on-brand headshot you can download in a click.",
    illustration: <StudioIllus />,
    Icon: UserRound,
  },
  {
    href: "/transcribe",
    title: "Transcribe to a Google Doc",
    body: "Upload a long recording and get a Doc with a summary and full timestamped transcript.",
    illustration: <TranscribeIllus />,
    Icon: Mic,
  },
  {
    href: "/slice",
    title: "Slice a deck into PDFs",
    body: "Convert a deck to PDF, split it by page ranges, speaker, or topic, and stamp each page.",
    illustration: <SliceIllus />,
    Icon: Scissors,
  },
  {
    href: "/convert",
    title: "Convert audio to mp3",
    body: "Turn a YouTube or video link, or an uploaded audio or video file, into an mp3 you can name and download.",
    illustration: <ConvertIllus />,
    Icon: AudioLines,
  },
];

export default function Home() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {TOOLS.map((t) => (
        <ToolCard key={t.href} href={t.href} title={t.title} body={t.body} illustration={t.illustration} Icon={t.Icon} />
      ))}
    </div>
  );
}
