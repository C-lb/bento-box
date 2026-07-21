"use client";

import { toolById } from "@/components/tools";

export interface WorkflowStepUI {
  toolId: string;
  instructionText: string;
  params: Record<string, unknown>;
  kindError?: string;
}

export function StepCard({
  step,
  index,
  onPointerDown,
  onInstructionChange,
  onInstructionBlur,
  onRemove,
}: {
  step: WorkflowStepUI;
  index: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onInstructionChange: (text: string) => void;
  onInstructionBlur: () => void;
  onRemove: () => void;
}) {
  const tool = toolById(step.toolId);
  return (
    <li data-row className="rounded-lg border border-line/60 bg-surface p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Drag to reorder step ${index + 1}`}
          className="cursor-grab p-1 text-muted"
          onPointerDown={onPointerDown}
        >
          ⠿
        </button>
        {tool && <tool.Icon size={16} aria-hidden />}
        <span className="text-sm font-medium">{tool?.title ?? step.toolId}</span>
        <button type="button" className="ml-auto text-xs text-danger underline underline-offset-2" onClick={onRemove}>
          Remove
        </button>
      </div>
      <textarea
        className="mt-2 w-full rounded-md border border-line/60 bg-transparent p-2 text-sm"
        value={step.instructionText}
        onChange={(e) => onInstructionChange(e.target.value)}
        onBlur={onInstructionBlur}
        rows={2}
      />
      {step.kindError && <p className="mt-1 text-xs text-danger">{step.kindError}</p>}
      <p className="mt-1 text-xs text-muted">{JSON.stringify(step.params)}</p>
    </li>
  );
}
