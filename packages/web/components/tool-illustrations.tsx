export function SorterIllus() {
  // Hover: the #1 tile scales up, siblings dim, reads as ranked best-first.
  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-2 motion-safe:[.group:hover_&>div:not(:first-child)]:opacity-50">
      <div className="relative rounded-lg bg-[#e4e7ec] transition-transform duration-300 motion-safe:group-hover:scale-110">
        <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-soft">1</span>
      </div>
      <div className="rounded-lg bg-[#d7dbe1] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#e4e7ec] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#e4e7ec] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#d7dbe1] transition-opacity duration-300" />
      <div className="rounded-lg bg-[#e4e7ec] transition-opacity duration-300" />
    </div>
  );
}

export function StudioIllus() {
  // Hover: brand bar grows to full width, accent frame draws around the avatar.
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5">
      <div className="grid h-24 w-24 place-items-center rounded-xl bg-[#e4e7ec] ring-0 ring-accent transition-all duration-300 motion-safe:group-hover:ring-2">
        <div className="h-9 w-9 rounded-full bg-[#d7dbe1]" />
      </div>
      <div className="h-2.5 w-16 rounded-full bg-gradient-to-r from-accent to-[#7aa0ff] opacity-90 transition-all duration-300 motion-safe:group-hover:w-28" />
    </div>
  );
}

export function TranscribeIllus() {
  const bars = [22, 40, 16, 52, 30, 46, 20, 36, 26, 48, 18];
  // Hover: bars pulse like an equalizer, text lines wipe in left to right.
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-1.5" style={{ height: 56 }}>
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-1.5 origin-bottom rounded-full bg-[#e4e7ec] motion-safe:group-hover:animate-[eq_0.7s_ease-in-out_infinite]"
            style={{ height: h, animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="h-2 rounded-full bg-[#e4e7ec] transition-[width] duration-500 motion-safe:w-0 motion-safe:[.group:hover_&]:w-[92%] motion-reduce:w-[92%]" />
        <div className="h-2 rounded-full bg-[#e4e7ec] transition-[width] delay-100 duration-500 motion-safe:w-0 motion-safe:[.group:hover_&]:w-[76%] motion-reduce:w-[76%]" />
      </div>
    </div>
  );
}

export function ConvertIllus() {
  const bars = [16, 34, 14, 44, 24, 38, 18, 30];
  // Hover: the link chip fades, the waveform pulses in, reads as link becoming audio.
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 items-center gap-1.5 rounded-full bg-[#e4e7ec] px-3 transition-opacity duration-300 motion-safe:group-hover:opacity-40">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
            <path d="M9 17H7a5 5 0 0 1 0-10h2" />
            <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <span className="h-1.5 w-16 rounded-full bg-[#d7dbe1]" />
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="13 6 19 12 13 18" />
        </svg>
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 56 }}>
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-1.5 origin-bottom rounded-full bg-[#e4e7ec] motion-safe:group-hover:animate-[eq_0.7s_ease-in-out_infinite]"
            style={{ height: h, animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SliceIllus() {
  const splits = ["40%", "32%", "52%"];
  // Hover: panels nudge apart, cut-lines settle in.
  return (
    <div className="flex h-full items-center gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`relative h-[104px] flex-1 overflow-hidden rounded-lg border border-[#e4e7ec] bg-surface transition-transform duration-300 ${
            i === 0 ? "motion-safe:group-hover:-translate-x-1" : i === 2 ? "motion-safe:group-hover:translate-x-1" : ""
          }`}
        >
          {i === 0 && (
            <span className="absolute right-1.5 top-1.5 rounded-full border border-[#e4e7ec] bg-surface px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-muted">
              confidential
            </span>
          )}
          <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1] transition-all duration-300 motion-safe:group-hover:border-accent" style={{ top: splits[i] }} />
          {i === 1 && <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1] transition-all duration-300 motion-safe:group-hover:border-accent" style={{ top: "64%" }} />}
        </div>
      ))}
    </div>
  );
}

import type { ReactNode } from "react";

const ILLUSTRATIONS: Record<string, ReactNode> = {
  sorter: <SorterIllus />,
  studio: <StudioIllus />,
  transcribe: <TranscribeIllus />,
  slice: <SliceIllus />,
  convert: <ConvertIllus />,
};

export function getIllustration(id: string): ReactNode {
  return ILLUSTRATIONS[id] ?? null;
}
