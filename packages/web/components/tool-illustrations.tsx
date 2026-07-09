import type { ReactNode } from "react";

// House palette for these thumbnails: neutral grey tiles, one accent touch each,
// no decorative second hue (anti-vibecode). Every illustration fills its card
// box edge to edge via h-full + flex-1 / grid stretch; the card's own p-4 is the
// only margin. Hovers are motion-safe and subtle.
const TILE = "bg-[#e4e7ec]";
const TILE2 = "bg-[#d7dbe1]";

export function SorterIllus() {
  // Ranked photo grid: at rest, plain tiles. On hover, numbered bubbles 1-6
  // pop onto each tile in a left-to-right, top-to-bottom stagger, reading as
  // "ranked best to last" without singling one tile out.
  const tiles = [TILE, TILE2, TILE, TILE, TILE2, TILE];
  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-2">
      {tiles.map((tile, i) => (
        <div key={i} className={`relative rounded-lg ${tile}`}>
          <span
            className="absolute left-1.5 top-1.5 grid h-5 w-5 scale-75 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white opacity-0 shadow-soft transition-all duration-300 motion-safe:group-hover:scale-100 motion-safe:group-hover:opacity-100"
            style={{ transitionDelay: `${i * 70}ms` }}
          >
            {i + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

export function StudioIllus() {
  // A centered person: round head + shoulders bust, drawn as a fixed-ratio SVG so
  // it never stretches with the (wide) card box. Shoulders bleed off the bottom.
  // Accent frame draws in on hover (the one accent touch).
  return (
    <div className={`relative grid h-full place-items-center overflow-hidden rounded-xl ${TILE} ring-0 ring-accent transition-all duration-300 motion-safe:group-hover:ring-2`}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full transition-transform duration-300 motion-safe:group-hover:scale-105"
        fill="#d7dbe1"
        aria-hidden
      >
        <circle cx="50" cy="35" r="18" />
        <path d="M50 57c-17 0-30 12-32 29a2 2 0 0 0 2 3h60a2 2 0 0 0 2-3c-2-17-15-29-32-29Z" />
      </svg>
    </div>
  );
}

export function TranscribeIllus() {
  const bars = [28, 54, 20, 72, 40, 64, 24, 50, 34, 68, 22, 58, 30, 76, 44, 60, 26, 52, 38, 70, 24, 62, 32, 56];
  // Waveform fills the upper area, transcript lines wipe in below.
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-end gap-[2px]">
        {bars.map((h, i) => (
          <span
            key={i}
            className={`flex-1 origin-bottom rounded-full ${TILE} motion-safe:group-hover:animate-[eq_0.7s_ease-in-out_infinite]`}
            style={{ height: `${h}%`, animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className={`h-2.5 rounded-full ${TILE} transition-[width] duration-500 motion-safe:w-0 motion-safe:[.group:hover_&]:w-[92%] motion-reduce:w-[92%]`} />
        <div className={`h-2.5 rounded-full ${TILE} transition-[width] delay-100 duration-500 motion-safe:w-0 motion-safe:[.group:hover_&]:w-[70%] motion-reduce:w-[70%]`} />
      </div>
    </div>
  );
}

export function ConvertIllus() {
  const bars = [32, 58, 24, 74, 38, 62, 28, 80, 44, 54, 22, 68, 36, 60, 26, 72, 40, 64, 30, 56, 42, 66, 20, 70];
  // Link chip becomes audio: a link + mp3 pill on top, a full waveform filling below.
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className={`flex h-9 flex-1 items-center gap-2 rounded-xl ${TILE} px-3 transition-opacity duration-300 motion-safe:group-hover:opacity-40`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
            <path d="M9 17H7a5 5 0 0 1 0-10h2" />
            <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <span className={`h-1.5 flex-1 rounded-full ${TILE2}`} />
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="13 6 19 12 13 18" />
        </svg>
        <span className="grid h-9 place-items-center rounded-xl bg-accent px-3 text-[11px] font-semibold text-white shadow-soft">mp3</span>
      </div>
      <div className="flex flex-1 items-center gap-[2px]">
        {bars.map((h, i) => (
          <span
            key={i}
            className={`flex-1 rounded-full ${TILE} motion-safe:group-hover:animate-[eq_0.7s_ease-in-out_infinite]`}
            style={{ height: `${h}%`, animationDelay: `${i * 38}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SliceIllus() {
  const splits = ["42%", "34%", "54%"];
  // Deck panels fill full height; cut lines settle to accent on hover, panels nudge apart.
  return (
    <div className="flex h-full items-stretch gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`relative flex-1 overflow-hidden rounded-lg border border-[#e4e7ec] bg-surface transition-transform duration-300 ${
            i === 0 ? "motion-safe:group-hover:-translate-x-1" : i === 2 ? "motion-safe:group-hover:translate-x-1" : ""
          }`}
        >
          {i === 0 && (
            <span className="absolute right-1.5 top-1.5 rounded-full border border-[#e4e7ec] bg-surface px-1.5 py-0.5 text-[8px] font-semibold tracking-wide text-muted">
              confidential
            </span>
          )}
          <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1] transition-colors duration-300 motion-safe:group-hover:border-accent" style={{ top: splits[i] }} />
          {i === 1 && <span className="absolute inset-x-0 border-t-2 border-dashed border-[#d7dbe1] transition-colors duration-300 motion-safe:group-hover:border-accent" style={{ top: "68%" }} />}
        </div>
      ))}
    </div>
  );
}

export function PdfIllus() {
  // Left: a stack of sheets merging. Right: a sheet split by a dashed line (accent on hover).
  return (
    <div className="grid h-full grid-cols-2 gap-4">
      <div className="relative">
        <div className={`absolute inset-0 translate-x-3 translate-y-3 rounded-lg ${TILE2}`} />
        <div className={`absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg ${TILE}`} />
        <div className="absolute inset-0 rounded-lg border border-[#e4e7ec] bg-surface transition-transform duration-300 motion-safe:group-hover:-translate-y-1">
          <div className="flex h-full flex-col justify-center gap-2 px-3">
            <span className={`h-1.5 w-2/3 rounded-full ${TILE}`} />
            <span className={`h-1.5 w-full rounded-full ${TILE}`} />
            <span className={`h-1.5 w-1/2 rounded-full ${TILE}`} />
          </div>
        </div>
      </div>
      <div className="relative rounded-lg border border-[#e4e7ec] bg-surface">
        <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-[#d7dbe1] transition-colors duration-300 motion-safe:group-hover:border-accent" />
        <span className="absolute right-2 top-[calc(50%-9px)] grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-white shadow-soft">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </span>
      </div>
    </div>
  );
}

export function HeicIllus() {
  // Photo tile converts to jpg: source tile, arrow, a jpg-labelled tile. Both fill height.
  // Photo glyphs are centred and sized to fill each tile.
  return (
    <div className="flex h-full items-stretch gap-3">
      <div className={`relative flex-1 overflow-hidden rounded-xl ${TILE}`}>
        <span className="absolute left-2 top-2 rounded-md bg-surface/80 px-1.5 py-0.5 text-[9px] font-semibold text-muted">heic</span>
        <div className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 24 24" className="h-12 w-12 text-[#c3c8d0]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="2" /><path d="m21 15-4-4L5 21" /></svg>
        </div>
      </div>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 self-center text-muted">
        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
      </svg>
      <div className="relative flex-1 overflow-hidden rounded-xl border border-[#e4e7ec] bg-surface transition-transform duration-300 motion-safe:group-hover:-translate-y-1">
        <span className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-soft">jpg</span>
        <div className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 24 24" className="h-12 w-12 text-[#c3c8d0]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="2" /><path d="m21 15-4-4L5 21" /></svg>
        </div>
      </div>
    </div>
  );
}

export function ResizeIllus() {
  // A photo tile shrinks: an inner dashed frame with corner handles pulls inward on hover.
  // The photo glyph is centred and sized to fill the frame.
  return (
    <div className={`relative h-full overflow-hidden rounded-xl ${TILE}`}>
      <div className="absolute inset-0 grid place-items-center">
        <svg viewBox="0 0 24 24" className="h-20 w-20 text-[#c3c8d0]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="9" r="2" /><path d="m21 15-4-4L5 21" /></svg>
      </div>
      <div className="absolute inset-5 rounded-lg border-2 border-dashed border-[#b9bfc9] transition-all duration-300 motion-safe:group-hover:inset-8 motion-safe:group-hover:border-accent" />
      <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-sm bg-accent shadow-soft" />
      <span className="absolute bottom-2 left-2 h-2.5 w-2.5 rounded-sm bg-accent shadow-soft" />
    </div>
  );
}

export function VideoIllus() {
  // Film strip fills the box; a play glyph centred, sprocket rails top and bottom.
  return (
    <div className={`relative flex h-full flex-col overflow-hidden rounded-xl ${TILE}`}>
      <div className="flex justify-between px-2 py-1.5">
        {Array.from({ length: 7 }).map((_, i) => <span key={i} className="h-2 w-3 rounded-[3px] bg-surface/70" />)}
      </div>
      <div className="grid flex-1 place-items-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-accent text-white shadow-soft transition-transform duration-300 motion-safe:group-hover:scale-110">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </span>
      </div>
      <div className="flex justify-between px-2 py-1.5">
        {Array.from({ length: 7 }).map((_, i) => <span key={i} className="h-2 w-3 rounded-[3px] bg-surface/70" />)}
      </div>
    </div>
  );
}

export function SpliceIllus() {
  // Three clips with a trim handle sliding in; they read as joined end to end.
  return (
    <div className="flex h-full items-stretch gap-1.5">
      <div className={`flex-1 rounded-l-xl ${TILE}`} />
      <div className="relative flex-1">
        <div className={`h-full rounded-xl ${TILE2} ring-2 ring-accent`} />
        <span className="absolute -left-1 top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-full bg-accent shadow-soft transition-transform duration-300 motion-safe:group-hover:-translate-x-1" />
        <span className="absolute -right-1 top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-full bg-accent shadow-soft transition-transform duration-300 motion-safe:group-hover:translate-x-1" />
      </div>
      <div className={`flex-1 rounded-r-xl ${TILE}`} />
    </div>
  );
}

export function QrIllus() {
  // A QR-like module grid filling the box, with three finder squares and one accent module.
  const mods = [
    1,1,1,0,1,0,1,1,1,
    1,0,1,0,0,0,1,0,1,
    1,1,1,0,1,0,1,1,1,
    0,0,0,0,0,1,0,0,0,
    1,0,1,1,0,0,1,1,0,
    0,0,0,1,1,0,0,0,1,
    1,1,1,0,1,0,1,0,1,
    1,0,1,0,0,1,0,0,0,
    1,1,1,0,1,1,0,1,1,
  ];
  // A few modules gently pulse in a loop while hovered, suggesting the code is "live".
  const pulseMods = new Set([2, 42, 63, 77]);
  return (
    <div className="grid h-full place-items-center">
      <div className="grid aspect-square h-full grid-cols-9 grid-rows-9 gap-[3px]">
        {mods.map((m, i) => (
          <span
            key={i}
            className={`rounded-[2px] ${m ? (i === 40 ? "bg-accent" : "bg-[#33383f]") : "bg-transparent"} ${m && i !== 40 ? "transition-colors duration-300 motion-safe:group-hover:bg-[#20242a]" : ""} ${m && pulseMods.has(i) ? "qr-pulse-mod" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}

export function ShortenIllus() {
  // A long www.something.com bar; on hover it compresses and hands over to the short accent pill.
  return (
    <div className="flex h-full items-center gap-3">
      <div className={`flex h-9 flex-1 items-center overflow-hidden rounded-xl ${TILE} px-3 transition-all duration-300 motion-safe:group-hover:flex-[0.3] motion-safe:group-hover:opacity-40`}>
        <span className="truncate text-[11px] font-medium text-muted">www.something.com/a-really-long-link</span>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted transition-opacity duration-300 motion-safe:opacity-30 motion-safe:group-hover:opacity-100">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="13 6 19 12 13 18" />
      </svg>
      <span className="grid h-9 shrink-0 place-items-center rounded-full bg-accent px-3 text-[11px] font-semibold text-white shadow-soft transition-all duration-300 motion-safe:scale-90 motion-safe:opacity-40 motion-safe:group-hover:scale-100 motion-safe:group-hover:opacity-100">
        is.gd/x8
      </span>
    </div>
  );
}

export function CutoutIllus() {
  // A plain, opaque tile at rest; on hover a transparency checkerboard fades
  // in behind the subject, reading as "background becoming transparent".
  // Person glyph matches Studio's size/scale for a consistent bust icon.
  return (
    <div className="relative h-full overflow-hidden rounded-xl bg-surface">
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-300 motion-safe:group-hover:opacity-60"
        style={{
          backgroundImage: "linear-gradient(45deg,#e4e7ec 25%,transparent 25%,transparent 75%,#e4e7ec 75%),linear-gradient(45deg,#e4e7ec 25%,transparent 25%,transparent 75%,#e4e7ec 75%)",
          backgroundSize: "18px 18px",
          backgroundPosition: "0 0,9px 9px",
        }}
      />
      <div className="absolute inset-0 grid place-items-center">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full text-[#c3c8d0] drop-shadow-sm transition-colors duration-300 motion-safe:group-hover:text-accent"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="50" cy="35" r="18" />
          <path d="M50 57c-17 0-30 12-32 29a2 2 0 0 0 2 3h60a2 2 0 0 0 2-3c-2-17-15-29-32-29Z" />
        </svg>
      </div>
    </div>
  );
}

function DocLines({ n = 3, className = "" }: { n?: number; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className={`h-1.5 rounded-full ${TILE}`} style={{ width: `${70 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function CertificateIllus() {
  // A landscape certificate sheet fills the box: title lines, an accent-underlined name, a seal.
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-[#e4e7ec] bg-surface px-6">
      <span className={`h-2 w-24 rounded-full ${TILE}`} />
      <span className="h-3 w-36 rounded-full bg-[#33383f]" />
      <span className="h-1 w-28 rounded-full bg-accent" />
      <DocLines n={2} className="mt-1" />
      <span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-accent text-white shadow-soft transition-transform duration-300 motion-safe:group-hover:scale-110">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="9" r="6" /><path d="M8.5 14.5 7 22l5-3 5 3-1.5-7.5" /></svg>
      </span>
    </div>
  );
}

export function BadgeIllus() {
  // A landscape name badge (matches the 4x3 print size): lanyard clip, name lines, a QR square.
  return (
    <div className="grid h-full place-items-center">
      <div className="relative flex h-[82%] w-full items-center gap-3 rounded-xl border border-[#e4e7ec] bg-surface px-4 shadow-soft transition-transform duration-300 motion-safe:group-hover:-translate-y-1">
        <span className="absolute -top-1.5 left-1/2 h-3 w-10 -translate-x-1/2 rounded-full bg-[#c3c8d0]" />
        <div className="flex flex-1 flex-col gap-2">
          <span className={`h-2 w-12 rounded-full ${TILE}`} />
          <span className="h-3.5 w-full rounded-full bg-[#33383f]" />
          <span className={`h-2 w-3/4 rounded-full ${TILE}`} />
        </div>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-accent p-1.5">
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="h-full w-full text-white/85" fill="currentColor" aria-hidden>
            <circle cx="50" cy="35" r="18" />
            <path d="M50 57c-17 0-30 12-32 29a2 2 0 0 0 2 3h60a2 2 0 0 0 2-3c-2-17-15-29-32-29Z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

export function PlaceCardIllus() {
  // A folded tent place card: a back panel and a raised front panel with a centred name.
  return (
    <div className="grid h-full place-items-center">
      <div className="relative h-[84%] w-[94%]">
        <div className={`absolute inset-x-6 top-0 h-1/2 rounded-t-lg ${TILE2}`} />
        <div className="absolute inset-x-0 bottom-0 flex h-[64%] flex-col items-center justify-center gap-2 rounded-lg border border-[#e4e7ec] bg-surface shadow-soft transition-transform duration-300 motion-safe:group-hover:-translate-y-0.5">
          <span className="h-3.5 w-32 rounded-full bg-[#33383f]" />
          <span className="h-1 w-12 rounded-full bg-accent" />
        </div>
      </div>
    </div>
  );
}

export function TicketIllus() {
  // An event ticket: a stub with a name line, a perforation, and a QR panel.
  return (
    <div className="grid h-full place-items-center">
      <div className="relative flex h-[74%] w-full overflow-hidden rounded-xl border border-[#e4e7ec] bg-surface shadow-soft transition-transform duration-300 motion-safe:group-hover:-translate-y-1">
        <div className="flex flex-1 flex-col justify-center gap-2 px-4">
          <span className="h-1.5 w-14 rounded-full bg-accent" />
          <span className="h-3 w-4/5 rounded-full bg-[#33383f]" />
          <span className={`h-1.5 w-2/3 rounded-full ${TILE}`} />
        </div>
        <div className="relative w-[34%] border-l-2 border-dashed border-[#d7dbe1]">
          <span className="absolute -left-1.5 top-0 h-3 w-3 -translate-y-1/2 rounded-full bg-[#eef0f3]" />
          <span className="absolute -left-1.5 bottom-0 h-3 w-3 translate-y-1/2 rounded-full bg-[#eef0f3]" />
          <div className="grid h-full place-items-center">
            <span className="grid h-9 w-9 grid-cols-3 grid-rows-3 gap-[2px] rounded-[4px] bg-[#33383f] p-1.5">
              {Array.from({ length: 9 }).map((_, i) => <span key={i} className={[0, 2, 4, 6, 8].includes(i) ? "rounded-[1px] bg-white/85" : ""} />)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const ILLUSTRATIONS: Record<string, ReactNode> = {
  sorter: <SorterIllus />,
  studio: <StudioIllus />,
  transcribe: <TranscribeIllus />,
  slice: <SliceIllus />,
  convert: <ConvertIllus />,
  pdf: <PdfIllus />,
  heic: <HeicIllus />,
  resize: <ResizeIllus />,
  video: <VideoIllus />,
  splice: <SpliceIllus />,
  qr: <QrIllus />,
  shorten: <ShortenIllus />,
  cutout: <CutoutIllus />,
  certificate: <CertificateIllus />,
  badge: <BadgeIllus />,
  "place-card": <PlaceCardIllus />,
  ticket: <TicketIllus />,
};

export function getIllustration(id: string): ReactNode {
  return ILLUSTRATIONS[id] ?? null;
}
