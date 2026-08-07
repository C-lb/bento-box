"use client";
import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { loadGooglePicker, fetchPickerToken } from "@/lib/google/pickerClient";

export type PickedDoc = { id: string; name: string };

/** Google Doc chooser backed by Google's native Picker. Picking through the
 *  Picker is what grants this app drive.file access to the chosen document,
 *  which is why there is deliberately no paste-a-URL alternative. */
export function DocPicker({
  onPick,
  disabled,
}: {
  onPick: (file: PickedDoc) => void;
  disabled?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setError(null);
    setOpening(true);
    try {
      const data = await fetchPickerToken();
      await loadGooglePicker();
      const w = window as any;
      const p = w.google.picker;
      // Documents view: browse Docs (not folders as the destination), reaching
      // into shared drives via the SUPPORT_DRIVES feature.
      const view = new p.DocsView(p.ViewId.DOCUMENTS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      const builder = new p.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.access_token)
        .enableFeature(p.Feature.SUPPORT_DRIVES);
      if (data.apiKey) builder.setDeveloperKey(data.apiKey);
      if (data.appId) builder.setAppId(data.appId);
      const picker = builder
        .setCallback((res: any) => {
          if (res.action === p.Action.PICKED) {
            const doc = res.docs?.[0];
            if (doc) onPick({ id: doc.id, name: doc.name ?? doc.id });
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the Drive picker.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        disabled={disabled || opening}
        onClick={openPicker}
        className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center inline-flex items-center gap-2"
      >
        {opening ? (
          <Loader2 size={14} strokeWidth={1.75} className="shrink-0 animate-spin" aria-hidden />
        ) : (
          <FileText size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
        )}
        <span>Choose a Google Doc</span>
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
