"use client";

import { useCallback, useEffect, useState } from "react";
import { Segmented } from "@/components/Segmented";

type Format = "linkedin" | "article";
type ExampleItem = { id: number; text: string };
type ListResponse = { seed: ExampleItem[]; custom: ExampleItem[]; liked: ExampleItem[] };

const EMPTY: ListResponse = { seed: [], custom: [], liked: [] };

export function StyleExamples() {
  const [format, setFormat] = useState<Format>("linkedin");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (fmt: Format) => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await fetch(`/api/style-examples?format=${fmt}`);
      if (!r.ok) throw new Error();
      const d = (await r.json()) as ListResponse;
      setData(d);
    } catch {
      setData(EMPTY);
      setLoadError("Could not load examples.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    load(format);
  }, [format, load]);

  const examples: (ExampleItem & { kind: "seed" | "custom" })[] = data
    ? [
        ...data.seed.map((e) => ({ ...e, kind: "seed" as const })),
        ...data.custom.map((e) => ({ ...e, kind: "custom" as const })),
      ]
    : [];

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">
        Examples the summary writer imitates. Liked drafts are added automatically and used as extra
        inspiration.
      </p>

      <div className="mt-4">
        <Segmented
          options={[
            { value: "linkedin", label: "LinkedIn" },
            { value: "article", label: "Article" },
          ]}
          value={format}
          onChange={(v) => setFormat(v as Format)}
        />
      </div>

      <div className="card mt-3">
        {loading && !data && <p className="text-sm text-muted">Loading…</p>}

        {loadError && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-danger">{loadError}</p>
            <button type="button" className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={() => load(format)}>
              Try again
            </button>
          </div>
        )}

        {data && !loadError && (
          <div className="space-y-6">
            <AddExample format={format} onAdded={() => load(format)} />

            <div>
              <p className="text-sm font-medium text-ink">Examples</p>
              {examples.length === 0 && <p className="mt-2 text-sm text-muted">No examples yet.</p>}
              {examples.length > 0 && (
                <ul className="mt-3 space-y-3 divide-y divide-line/60">
                  {examples.map((item) => (
                    <li key={item.id} className="pt-3 first:pt-0">
                      <ExampleRow item={item} kind={item.kind} onChanged={() => load(format)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-ink">Liked drafts</p>
              {data.liked.length === 0 && (
                <p className="mt-2 text-sm text-muted">
                  No liked drafts yet. Like a generated draft to add it here.
                </p>
              )}
              {data.liked.length > 0 && (
                <ul className="mt-3 space-y-3 divide-y divide-line/60">
                  {data.liked.map((item) => (
                    <li key={item.id} className="pt-3 first:pt-0">
                      <LikedRow item={item} onChanged={() => load(format)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddExample({ format, onAdded }: { format: Format; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Write an example first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/style-examples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format, text: trimmed }),
      });
      if (!r.ok) throw new Error();
      setText("");
      onAdded();
    } catch {
      setError("Could not add the example.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-medium text-ink">Add example</p>
      <textarea
        className="field mt-2 min-h-[80px] resize-y"
        placeholder="Paste an example the summary writer should imitate…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={add} disabled={busy || !text.trim()}>
          {busy ? "Adding…" : "Add"}
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}

function ExampleRow({
  item,
  kind,
  onChanged,
}: {
  item: ExampleItem;
  kind: "seed" | "custom";
  onChanged: () => void;
}) {
  const [text, setText] = useState(item.text);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = text.trim() !== item.text;
  const busy = saving || deleting;

  async function save() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Example can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/style-examples/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!r.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
      onChanged();
    } catch {
      setError("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(`/api/style-examples/${item.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onChanged();
    } catch {
      setError("Could not delete.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{kind === "seed" ? "Seed example" : "Custom example"}</span>
      </div>
      <textarea
        className="field mt-2 min-h-[80px] resize-y"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1 sm:gap-3">
        <button type="button" className="btn min-h-[44px] sm:min-h-0" onClick={save} disabled={busy || !dirty}>
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-danger">Delete this example?</span>
            <button
              type="button"
              className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
              onClick={doDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Yes"}
            </button>
            <button
              type="button"
              className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-ink underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-sm text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
          >
            Delete
          </button>
        )}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}

function LikedRow({ item, onChanged }: { item: ExampleItem; onChanged: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doRemove() {
    setRemoving(true);
    setError(null);
    try {
      const r = await fetch(`/api/style-examples/${item.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onChanged();
    } catch {
      setError("Could not remove.");
      setRemoving(false);
      setConfirmingRemove(false);
    }
  }

  return (
    <div>
      <p className="whitespace-pre-wrap text-sm text-ink">{item.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1 sm:gap-3">
        {confirmingRemove ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-danger">Remove this liked draft?</span>
            <button
              type="button"
              className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
              onClick={doRemove}
              disabled={removing}
            >
              {removing ? "Removing…" : "Yes"}
            </button>
            <button
              type="button"
              className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-ink underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => setConfirmingRemove(false)}
              disabled={removing}
            >
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-sm text-danger underline underline-offset-2 disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setConfirmingRemove(true)}
            disabled={removing}
          >
            Remove
          </button>
        )}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
