import { getConnections } from "@event-editor/core/settings";
import { findSoffice } from "@/lib/pptx-convert";
import { SliceClient } from "./SliceClient";
import { PastSlices } from "./PastSlices";

export const dynamic = "force-dynamic";

export default function SlicePage() {
  const conns = getConnections();
  const anthropic = conns.find((c) => c.id === "anthropic");
  const soffice = !!findSoffice();

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Slice a deck into PDFs</h1>
        </div>
        <PastSlices />
      </div>

      {!soffice ? (
        <div className="card mt-8">
          <p className="font-medium">LibreOffice is required</p>
          <p className="mt-2 text-muted">
            This tool converts PowerPoint to PDF locally with LibreOffice so confidential decks never leave your machine.
          </p>
          <p className="mt-2 text-muted">
            Install it from libreoffice.org (or `brew install --cask libreoffice` on macOS), then restart this app.
          </p>
        </div>
      ) : !anthropic?.configured ? (
        <div className="mt-8">
          <p className="text-muted">Set ANTHROPIC_API_KEY in .env to use speaker segmentation, then restart. Manual page slicing works without it.</p>
          <div className="mt-5"><SliceClient hasAi={false} /></div>
        </div>
      ) : (
        <div className="mt-8">
          <SliceClient hasAi={true} />
        </div>
      )}
    </div>
  );
}
