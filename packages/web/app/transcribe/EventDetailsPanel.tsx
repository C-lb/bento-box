"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";

interface Person { name: string; company: string }
export interface Details { eventName: string; eventDescription: string; speakers: Person[]; sponsors: Person[] }

function PeopleEditor({ label, rows, onChange }: { label: string; rows: Person[]; onChange: (r: Person[]) => void }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input className="field flex-1" placeholder="Name" value={r.name}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="field flex-1" placeholder="Company" value={r.company}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, company: e.target.value } : x))} />
            <button type="button" className="btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" className="btn inline-flex items-center gap-2" onClick={() => onChange([...rows, { name: "", company: "" }])}>
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}

export function EventDetailsPanel({ id, initial, onSaved }: { id: number; initial: Details; onSaved: () => void }) {
  const [d, setD] = useState<Details>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch(`/api/transcribe/${id}/details`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(d),
      });
      if (r.ok) { setSaved(true); onSaved(); setTimeout(() => setSaved(false), 1500); }
    } finally { setSaving(false); }
  }

  return (
    <div className="card mt-5">
      <p className="eyebrow">Event details</p>
      <p className="mt-2 text-sm text-muted">Correct anything below. Saving updates the LinkedIn and Article versions.</p>
      <label className="mt-4 block text-sm font-medium">Event name
        <input className="field mt-1 w-full" value={d.eventName} onChange={(e) => setD({ ...d, eventName: e.target.value })} />
      </label>
      <label className="mt-4 block text-sm font-medium">Description
        <textarea className="field mt-1 w-full" rows={3} value={d.eventDescription} onChange={(e) => setD({ ...d, eventDescription: e.target.value })} />
      </label>
      <PeopleEditor label="Speakers" rows={d.speakers} onChange={(speakers) => setD({ ...d, speakers })} />
      <PeopleEditor label="Sponsors and partners" rows={d.sponsors} onChange={(sponsors) => setD({ ...d, sponsors })} />
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn btn-accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
        {saved && <span className="text-sm text-success">Saved.</span>}
      </div>
    </div>
  );
}
