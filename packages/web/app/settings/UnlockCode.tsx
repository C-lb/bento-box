"use client";

import { useActionState, useEffect, useState } from "react";
import { applyUnlockCode, addSetupCode } from "./actions";
import type { SaveState } from "./actions";

const spinner = (
  <svg className="ico animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export function UnlockCode() {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(applyUnlockCode, null);
  const [addState, addAction, adding] = useActionState<SaveState, FormData>(addSetupCode, null);
  const [canRelaunch, setCanRelaunch] = useState(false);
  useEffect(() => setCanRelaunch(!!window.ee?.relaunch), []);

  return (
    <details className="card mt-3">
      <summary className="cursor-pointer text-sm text-muted hover:text-ink">Have a setup code?</summary>
      <p className="mt-2 text-sm text-muted">
        A setup code fills in the saved keys for you, no pasting needed.
      </p>
      <form action={formAction} className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          className="field min-h-[44px] sm:min-h-0 sm:max-w-xs"
          type="password"
          name="code"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
          placeholder="Setup code"
          aria-label="Setup code"
        />
        <button type="submit" className="btn min-h-[44px] sm:min-h-0 justify-center" disabled={pending}>
          {pending && spinner}
          {pending ? "Checking" : "Fill in keys"}
        </button>
        {state?.ok && canRelaunch && (
          <button type="button" className="btn min-h-[44px] sm:min-h-0 justify-center" onClick={() => window.ee?.relaunch()}>
            Restart now
          </button>
        )}
      </form>
      {state && (
        <p className={`mt-3 text-sm ${state.ok ? "text-success" : "text-danger"}`}>{state.message}</p>
      )}

      <div className="mt-5 border-t border-line/60 pt-4">
        <p className="text-sm font-medium">Add a setup code</p>
        <p className="mt-1 text-sm text-muted">
          Save your own code so it unlocks the keys on this machine from now on. The built-in code keeps working too.
        </p>
        <form action={addAction} className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            className="field min-h-[44px] sm:min-h-0 sm:max-w-xs"
            type="text"
            name="newCode"
            autoComplete="off"
            spellCheck={false}
            disabled={adding}
            placeholder="New setup code"
            aria-label="New setup code"
          />
          <button type="submit" className="btn min-h-[44px] sm:min-h-0 justify-center" disabled={adding}>
            {adding && spinner}
            {adding ? "Saving" : "Add setup code"}
          </button>
        </form>
        {addState && (
          <p className={`mt-3 text-sm ${addState.ok ? "text-success" : "text-danger"}`}>{addState.message}</p>
        )}
      </div>
    </details>
  );
}
