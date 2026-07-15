import { hasYtDlp } from "@/lib/convert";
import { AudioClient } from "./AudioClient";

// Reads a runtime binary presence check; must not be statically prerendered.
export const dynamic = "force-dynamic";

export default function AudioPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Audio from a link</h1>
          <p className="mt-1 text-sm text-muted">Paste a video or Spotify link and get back mp3, wav, or m4a.</p>
        </div>
      </div>
      <AudioClient ytDlp={hasYtDlp()} />
    </div>
  );
}
