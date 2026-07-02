export function SorterIllus() {
  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-2">
      <div className="relative rounded-lg bg-[#e4e7ec]">
        <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-soft">1</span>
      </div>
      <div className="rounded-lg bg-[#d7dbe1]" />
      <div className="rounded-lg bg-[#e4e7ec]" />
      <div className="rounded-lg bg-[#e4e7ec]" />
      <div className="rounded-lg bg-[#d7dbe1]" />
      <div className="rounded-lg bg-[#e4e7ec]" />
    </div>
  );
}

export function StudioIllus() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5">
      <div className="grid h-24 w-24 place-items-center rounded-xl bg-[#e4e7ec]">
        <div className="h-9 w-9 rounded-full bg-[#d7dbe1]" />
      </div>
      <div className="h-2.5 w-28 rounded-full bg-gradient-to-r from-accent to-[#7aa0ff] opacity-90" />
    </div>
  );
}

export function TranscribeIllus() {
  const bars = [22, 40, 16, 52, 30, 46, 20, 36, 26, 48, 18];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-1.5" style={{ height: 56 }}>
        {bars.map((h, i) => (
          <span key={i} className="w-1.5 rounded-full bg-[#e4e7ec]" style={{ height: h }} />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="h-2 rounded-full bg-[#e4e7ec]" style={{ width: "92%" }} />
        <div className="h-2 rounded-full bg-[#e4e7ec]" style={{ width: "76%" }} />
      </div>
    </div>
  );
}

export function SliceIllus() {
  const splits = ["40%", "32%", "52%"];
  return (
    <div className="flex h-full items-center gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative h-[104px] flex-1 overflow-hidden rounded-lg border border-[#e4e7ec] bg-surface">
          {i === 0 && (
            <span className="absolute right-1.5 top-1.5 rounded-full border border-[#e4e7ec] bg-surface px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-muted">
              confidential
            </span>
          )}
          <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1]" style={{ top: splits[i] }} />
          {i === 1 && <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1]" style={{ top: "64%" }} />}
        </div>
      ))}
    </div>
  );
}
