"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { kindsFor, canFollow } from "@/lib/workflow/compat";
import type { StepKind } from "@/lib/workflow/types";
import { StepCard, type WorkflowStepUI } from "@/components/workflow/StepCard";
import { AddStepPicker } from "@/components/workflow/AddStepPicker";

function validateChain(steps: WorkflowStepUI[]): WorkflowStepUI[] {
  return steps.map((s, i) => {
    if (i === 0) return { ...s, kindError: undefined };
    const prevKinds = kindsFor(steps[i - 1].toolId);
    const kinds = kindsFor(s.toolId);
    if (!prevKinds || !kinds || !canFollow(prevKinds.outputKind, kinds.inputKind)) {
      return { ...s, kindError: `"${steps[i - 1].toolId}"'s output doesn't match "${s.toolId}"'s input.` };
    }
    return { ...s, kindError: undefined };
  });
}

export function WorkflowClient() {
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState<WorkflowStepUI[]>([]);
  const [proposing, setProposing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragIdx = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const isValid = steps.length > 0 && steps.every((s) => !s.kindError);

  async function propose() {
    setProposing(true);
    setError(null);
    try {
      const res = await fetch("/api/workflow/propose", { method: "POST", body: JSON.stringify({ goal }) });
      if (!res.ok) {
        setError("Couldn't propose a chain for that goal. Try again.");
        return;
      }
      const body = await res.json();
      const proposed = (body.steps ?? []).map((s: Omit<WorkflowStepUI, "uid">) => ({ ...s, uid: crypto.randomUUID() }));
      setSteps(validateChain(proposed));
    } catch {
      setError("Couldn't propose a chain for that goal. Try again.");
    } finally {
      setProposing(false);
    }
  }

  function onPointerDown(e: React.PointerEvent, i: number) {
    e.preventDefault();
    dragIdx.current = i;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragIdx.current === null || !listRef.current) return;
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-row]"));
    const y = e.clientY;
    let target = dragIdx.current;
    rows.forEach((r, j) => {
      const rect = r.getBoundingClientRect();
      if (y > rect.top + rect.height / 2) target = Math.max(target, j);
      if (y < rect.top + rect.height / 2 && j <= dragIdx.current!) target = Math.min(target, j);
    });
    if (target !== dragIdx.current) {
      setSteps((prev) => {
        const next = prev.slice();
        const [m] = next.splice(dragIdx.current!, 1);
        next.splice(target, 0, m);
        return validateChain(next);
      });
      dragIdx.current = target;
    }
  }
  function onPointerUp() {
    dragIdx.current = null;
  }

  function reSynthesize(i: number, text: string) {
    setSteps((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i], instructionText: text };
      return next;
    });
  }

  // Re-synthesizing params for an edited step's instruction must infer params
  // for that step's KNOWN toolId, not re-run the full goal->chain planner on
  // the edited text in isolation (which has no idea it's describing one step
  // of an existing chain and can propose an unrelated tool, or none at all).
  // /api/workflow/synthesize wraps synthesizeParams(toolId, instructionText,
  // paramsSchema) directly for exactly this case.
  async function onInstructionBlur(i: number) {
    const step = steps[i];
    if (!step.instructionText.trim()) return;
    const res = await fetch("/api/workflow/synthesize", {
      method: "POST",
      body: JSON.stringify({ toolId: step.toolId, instructionText: step.instructionText }),
    });
    if (!res.ok) return;
    const body = await res.json();
    const params = body.params ?? step.params;
    setSteps((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i], params };
      return next;
    });
  }

  function addStep(toolId: string) {
    setSteps((prev) => validateChain([...prev, { toolId, instructionText: "", params: {}, uid: crypto.randomUUID() }]));
    setPickerOpen(false);
  }
  function removeStep(i: number) {
    setSteps((prev) => validateChain(prev.filter((_, j) => j !== i)));
  }

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const saveRes = await fetch("/api/workflow", {
        method: "POST",
        body: JSON.stringify({ name: goal || "Untitled workflow", steps: steps.map((s) => ({ toolId: s.toolId, params: s.params })) }),
      });
      if (!saveRes.ok) {
        setError("Couldn't save the workflow. Try again.");
        return;
      }
      const { id } = await saveRes.json();
      const runRes = await fetch(`/api/workflow/${id}/run`, { method: "POST", body: JSON.stringify({ firstInput: null }) });
      if (!runRes.ok) {
        setError("Couldn't start the run. Try again.");
        return;
      }
      const { runId } = await runRes.json();
      setRunId(runId);
    } catch {
      setError("Couldn't run the workflow. Try again.");
    } finally {
      setRunning(false);
    }
  }

  const lastKind: StepKind | null = steps.length ? kindsFor(steps[steps.length - 1].toolId)?.outputKind ?? null : null;

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="text-lg font-semibold">Workflow</h1>
      <Link href="/workflows" className="mt-1 inline-block text-xs underline underline-offset-2">
        Saved workflows
      </Link>
      <textarea
        className="mt-3 w-full rounded-md border border-line/60 bg-transparent p-2 text-sm"
        placeholder="Describe what you want to do…"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        rows={3}
      />
      <button
        type="button"
        className="mt-2 rounded-md border border-line/60 px-3 py-1.5 text-sm disabled:opacity-50"
        disabled={proposing || !goal.trim()}
        onClick={propose}
      >
        {proposing ? "Proposing…" : "Propose chain"}
      </button>

      <ul ref={listRef} className="mt-4 space-y-2" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {steps.map((step, i) => (
          <StepCard
            key={step.uid}
            step={step}
            index={i}
            onPointerDown={(e) => onPointerDown(e, i)}
            onInstructionChange={(text) => reSynthesize(i, text)}
            onInstructionBlur={() => onInstructionBlur(i)}
            onRemove={() => removeStep(i)}
          />
        ))}
      </ul>

      {pickerOpen ? (
        <AddStepPicker prevOutputKind={lastKind} onPick={addStep} onClose={() => setPickerOpen(false)} />
      ) : (
        <button type="button" className="mt-2 text-sm underline underline-offset-2" onClick={() => setPickerOpen(true)}>
          + Add step
        </button>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" className="rounded-md border border-line/60 px-3 py-1.5 text-sm disabled:opacity-50" disabled={!isValid || running} onClick={run}>
          {running ? "Running…" : "Run"}
        </button>
      </div>
      {runId && <p className="mt-2 text-xs text-muted">Run started: {runId}</p>}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
