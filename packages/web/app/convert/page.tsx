import { hasYtDlp } from "@/lib/convert";
import { ConvertClient } from "./ConvertClient";

// Reads a runtime binary presence check; must not be statically prerendered.
export const dynamic = "force-dynamic";

export default function ConvertPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Convert files</h1>
          <p className="mt-1 text-sm text-muted">Audio from a file or link, images, pdf to images, images to pdf.</p>
        </div>
      </div>
      <ConvertClient ytDlp={hasYtDlp()} />
    </div>
  );
}
