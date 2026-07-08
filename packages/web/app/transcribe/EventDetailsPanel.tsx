"use client";
import { useState, useEffect, useMemo } from "react";
import { Plus, X, AlertTriangle } from "lucide-react";

interface Person { name: string; company: string }
export interface Details { eventName: string; eventDescription: string; speakers: Person[]; sponsors: Person[] }

function PeopleEditor({ label, rows, onChange }: { label: string; rows: Person[]; onChange: (r: Person[]) => void }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-col sm:flex-row gap-2">
            <input className="field flex-1 min-h-[44px] sm:min-h-0" placeholder="Name" value={r.name}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="field flex-1 min-h-[44px] sm:min-h-0" placeholder="Company" value={r.company}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, company: e.target.value } : x))} />
            <button
              type="button"
              className="btn min-h-[44px] sm:min-h-0 min-w-[44px] sm:min-w-0 justify-center"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              aria-label="Remove"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto inline-flex items-center justify-center gap-2"
          onClick={() => onChange([...rows, { name: "", company: "" }])}
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} /> Add
        </button>
      </div>
    </div>
  );
}

export function EventDetailsPanel({ id, initial, onSaved }: { id: number; initial: Details; onSaved: () => void }) {
  const [d, setD] = useState<Details>(initial);
  const [baseline, setBaseline] = useState<Details>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Dirty when the current form differs from the last-saved snapshot.
  const dirty = useMemo(() => JSON.stringify(d) !== JSON.stringify(baseline), [d, baseline]);

  // Warn before leaving/reloading the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const r = await fetch(`/api/transcribe/${id}/details`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(d),
      });
      if (r.status === 401) { window.location.assign("/login"); return; }
      if (r.ok) { setBaseline(d); setSaved(true); onSaved(); setTimeout(() => setSaved(false), 1500); }
      else setSaveError("Could not save these details. Please try again.");
    } catch {
      setSaveError("Could not save these details. Please try again.");
    } finally { setSaving(false); }
  }

  return (
    <div className="card mt-5">
      <p className="eyebrow">Event details</p>
      <p className="mt-2 text-sm text-muted">Correct anything below, then press Save details. Edits are not applied until you save. Saving updates the LinkedIn and Article versions.</p>
      <label className="mt-4 block text-sm font-medium">Event name
        <input className="field mt-1 w-full min-h-[44px] sm:min-h-0" value={d.eventName} onChange={(e) => setD({ ...d, eventName: e.target.value })} />
      </label>
      <label className="mt-4 block text-sm font-medium">Description
        <textarea className="field mt-1 w-full" rows={3} value={d.eventDescription} onChange={(e) => setD({ ...d, eventDescription: e.target.value })} />
      </label>
      <PeopleEditor label="Speakers" rows={d.speakers} onChange={(speakers) => setD({ ...d, speakers })} />
      <PeopleEditor label="Sponsors and partners" rows={d.sponsors} onChange={(sponsors) => setD({ ...d, sponsors })} />
      <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          type="button"
          className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save details"}
        </button>
        {dirty && !saving && (
          <span className="inline-flex items-center gap-1.5 text-sm text-amber-600">
            <AlertTriangle className="w-4 h-4" strokeWidth={1.75} aria-hidden /> Unsaved changes. Press Save details.
          </span>
        )}
        {saved && <span className="text-sm text-success">Saved.</span>}
        {saveError && <span className="text-sm text-danger">{saveError}</span>}
      </div>
    </div>
  );
}
