"use client";
import { useState } from "react";
import { Folder, Loader2 } from "lucide-react";
import { loadGooglePicker, fetchPickerToken } from "@/lib/google/pickerClient";

export type PickedFolder = { id: string; name: string };

/** Drive folder chooser backed by Google's native Picker. Browsing, search, and
 *  shared-drive access all come from the Picker itself, so a folder anywhere the
 *  account can reach is selectable, not just My Drive. */
export function FolderPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedFolder | null;
  onChange: (folder: PickedFolder | null) => void;
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
      // Folders-only view: show folders, let a folder be the selection, and reach
      // into shared drives via the SUPPORT_DRIVES feature.
      const view = new p.DocsView(p.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes("application/vnd.google-apps.folder");
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
            if (doc) onChange({ id: doc.id, name: doc.name ?? doc.id });
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
        className="field flex min-h-[44px] w-full items-center gap-2 text-left sm:min-h-0 sm:w-72"
      >
        {opening ? (
          <Loader2 size={14} strokeWidth={1.75} className="shrink-0 animate-spin text-muted" aria-hidden />
        ) : (
          <Folder size={14} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
        )}
        <span className={`truncate ${value ? "text-ink" : "text-muted"}`}>
          {value ? value.name : "Choose a folder"}
        </span>
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
