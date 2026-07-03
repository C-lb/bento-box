export type PillState = { id: string; label: string; ready: boolean };

export function ConnectionPills({ items }: { items: PillState[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((it) => (
        <span
          key={it.id}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 ${
            it.ready
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
              : "bg-amber-50 text-amber-700 ring-amber-600/20"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${it.ready ? "bg-emerald-500" : "bg-amber-500"}`} />
          {it.label} {it.ready ? "connected" : "needs setup"}
        </span>
      ))}
    </div>
  );
}
