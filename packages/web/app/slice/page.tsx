import { getConnections } from "@event-editor/core/settings";
import { getToken } from "@event-editor/core/tokens";
import { findSoffice } from "@/lib/pptx-convert";
import { getDb } from "@/lib/db";
import { SliceClient } from "./SliceClient";
import { PastSlices } from "./PastSlices";

export const dynamic = "force-dynamic";

export default function SlicePage() {
  const conns = getConnections();
  const anthropic = conns.find((c) => c.id === "anthropic");
  const soffice = !!findSoffice();
  const google = getToken(getDb(), "google") !== null;
  const canConvert = soffice || google;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Slice a deck into PDFs</h1>
        </div>
        <PastSlices />
      </div>

      {!canConvert ? (
        <div className="card mt-8">
          <p className="font-medium">LibreOffice or Google required</p>
          <p className="mt-2 text-muted">
            This tool converts PowerPoint to PDF locally with LibreOffice so confidential decks never leave your machine.
            Without LibreOffice, it falls back to converting via your Google account.
          </p>
          <p className="mt-2 text-muted">
            Install LibreOffice from libreoffice.org (or `brew install --cask libreoffice` on macOS) and restart this app,
            or <a className="underline" href="/settings">connect Google in settings</a>.
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
