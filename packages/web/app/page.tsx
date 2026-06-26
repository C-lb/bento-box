import { ToolCard } from "@/components/ToolCard";

export default function Home() {
  return (
    <div>
      <p className="eyebrow">Two tools, one workspace</p>
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
          body="Drop a photo into a Canva brand template and export a finished headshot."
        />
      </div>
    </div>
  );
}
