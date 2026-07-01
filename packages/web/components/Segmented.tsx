"use client";

interface Option { value: string; label: string }

export function Segmented({ options, value, onChange }: { options: Option[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-[10px] bg-[var(--surface-2,#ececec)] p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[8px] px-4 py-1.5 text-sm transition-colors ${
            value === o.value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
