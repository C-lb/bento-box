import { ConvertClient } from "./ConvertClient";

export default function ConvertPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Convert files</h1>
          <p className="mt-1 text-sm text-muted">Images, pdf to images, images to pdf, audio and video to mp3, wav, or m4a.</p>
        </div>
      </div>
      <ConvertClient />
    </div>
  );
}
