import { ToolCard } from "@/components/ToolCard";

export default function Home() {
  return (
    <div>
      <p className="eyebrow">Four tools, one workspace</p>
      <h1 className="mt-1 text-2xl font-semibold">What do you want to do</h1>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <ToolCard
          href="/sorter"
          eyebrow="Photo sorter"
          title="Rank Drive photos for LinkedIn"
          body="Scan a Google Drive folder and rank each photo for headshot fitness."
        />
        <ToolCard
          href="/studio"
          eyebrow="Headshot studio"
          title="Build a branded headshot"
          body="Turn a Google Drive photo into a clean, branded headshot you can download."
        />
        <ToolCard
          href="/transcribe"
          eyebrow="Audio transcriber"
          title="Transcribe audio to a Google Doc"
          body="Upload a large audio file and get a Google Doc with a summary and the full timestamped transcript."
        />
        <ToolCard
          href="/slice"
          eyebrow="Slide slicer"
          title="Slice a deck into confidential PDFs"
          body="Convert a PowerPoint to PDF, split it by page ranges or by speaker, and stamp each page confidential."
        />
      </div>
    </div>
  );
}
