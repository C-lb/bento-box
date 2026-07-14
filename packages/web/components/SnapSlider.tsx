"use client";

// A range slider with labelled checkpoints. While dragging, values landing near
// a checkpoint snap to it, so the standard sizes are easy to hit but any value
// in between is still reachable. Neutral styling; the value reads out beside the
// label. Reused across tools (quality, QR size, dimensions).
export function SnapSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  checkpoints = [],
  format = (v) => String(v),
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  checkpoints?: number[];
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  // Snap when within 4% of the range of a checkpoint.
  const threshold = (max - min) * 0.04;
  function handle(raw: number) {
    let next = raw;
    for (const cp of checkpoints) {
      if (Math.abs(raw - cp) <= threshold) { next = cp; break; }
    }
    onChange(next);
  }

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => handle(Number(e.target.value))}
        className="mt-2 w-full"
      />
      {checkpoints.length > 0 && (
        <div className="relative mt-1 h-4 select-none">
          {checkpoints.map((cp) => {
            const pct = ((cp - min) / (max - min)) * 100;
            return (
              <button
                key={cp}
                type="button"
                disabled={disabled}
                onClick={() => onChange(cp)}
                style={{ left: `${pct}%` }}
                className="absolute -translate-x-1/2 text-xs text-muted hover:text-ink"
                title={format(cp)}
              >
                {format(cp)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
