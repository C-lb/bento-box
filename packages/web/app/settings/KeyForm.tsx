"use client";

import { useActionState, useEffect, useState } from "react";
import { saveKeys, type SaveState } from "./actions";
import { KEY_GUIDES } from "./key-guides";

declare global {
  interface Window {
    ee?: { relaunch: () => Promise<void> };
  }
}

type Field = { name: string; label: string };
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Claude (Anthropic)", fields: [{ name: "ANTHROPIC_API_KEY", label: "API key" }] },
  { title: "Groq (transcription)", fields: [{ name: "GROQ_API_KEY", label: "API key" }] },
  {
    title: "Google",
    fields: [
      { name: "GOOGLE_CLIENT_ID", label: "Client ID" },
      { name: "GOOGLE_CLIENT_SECRET", label: "Client secret" },
    ],
  },
  {
    title: "Canva",
    fields: [
      { name: "CANVA_CLIENT_ID", label: "Client ID" },
      { name: "CANVA_CLIENT_SECRET", label: "Client secret" },
    ],
  },
  {
    title: "Spotify",
    fields: [
      { name: "SPOTIFY_CLIENT_ID", label: "Client ID" },
      { name: "SPOTIFY_CLIENT_SECRET", label: "Client secret" },
    ],
  },
];

export function KeyForm({ masked, configPath }: { masked: Record<string, string>; configPath: string }) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveKeys, null);
  const [canRelaunch, setCanRelaunch] = useState(false);
  useEffect(() => setCanRelaunch(!!window.ee?.relaunch), []);

  return (
    <form action={formAction} className="card mt-4">
      <p className="text-sm text-muted">
        Keys are stored on this computer at <code className="text-ink">{configPath}</code>. They take effect after the app
        restarts. Leave a field blank to keep its current value.
      </p>

      <div className="mt-5 space-y-6">
        {GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="text-sm font-medium text-ink">{g.title}</legend>
            {(() => {
              const guide = KEY_GUIDES[g.title];
              if (!guide) return null;
              return (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-muted hover:text-ink">How to get this</summary>
                  <div className="mt-2 text-muted">
                    {"note" in guide ? (
                      <p>{guide.note}</p>
                    ) : (
                      <ol className="list-decimal space-y-1 pl-5">
                        {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    )}
                  </div>
                </details>
              );
            })()}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {g.fields.map((f) => {
                const isSet = !!masked[f.name];
                return (
                  <label key={f.name} className="block">
                    <span className="mb-1 flex items-center gap-2 text-sm text-muted">
                      {f.label}
                      {isSet ? (
                        <span className="text-success">saved</span>
                      ) : (
                        <span className="text-muted/70">not set</span>
                      )}
                    </span>
                    {isSet && (
                      <span className="mb-1 block font-mono text-xs text-muted">{masked[f.name]}</span>
                    )}
                    <input
                      className="field min-h-[44px] sm:min-h-0"
                      type="password"
                      name={f.name}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={pending}
                      placeholder={isSet ? "Leave blank to keep" : "Paste key"}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
        <button type="submit" className="btn btn-accent min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" disabled={pending}>
          {pending && (
            <svg className="ico animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          )}
          {pending ? "Saving" : "Save keys"}
        </button>
        {state?.ok && canRelaunch && (
          <button type="button" className="btn min-h-[44px] sm:min-h-0 w-full sm:w-auto justify-center" onClick={() => window.ee?.relaunch()}>
            Restart now
          </button>
        )}
      </div>

      {state && (
        <p className={`mt-4 text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
      )}
    </form>
  );
}
