import { hasYtDlp } from "@/lib/convert";
import { ConvertClient } from "./ConvertClient";

// Reads a runtime binary presence check; must not be statically prerendered.
export const dynamic = "force-dynamic";

export default function ConvertPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Convert file/link to audio</h1>
        </div>
      </div>
      <ConvertClient ytDlp={hasYtDlp()} />
    </div>
  );
}
