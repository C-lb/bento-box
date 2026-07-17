// Tiny two-note chime for adding a favourite. Synthesized (no asset), quiet,
// and fire-and-forget: any AudioContext failure (autoplay policy, no audio
// device) is swallowed so favouriting never breaks.
function playNotes(notes: Array<{ freq: number; at: number }>): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    for (const { freq, at } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.25);
    }
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 600);
  } catch {
    // Sound is decoration; never let it throw into the click handler.
  }
}

/** E6 then A6: a short rising plink for adding a favourite. */
export function playFavouriteJingle(): void {
  playNotes([
    { freq: 1318.51, at: 0 },
    { freq: 1760.0, at: 0.09 },
  ]);
}

/** A6 then E6: the same plink descending, for removing a favourite. */
export function playUnfavouriteJingle(): void {
  playNotes([
    { freq: 1760.0, at: 0 },
    { freq: 1318.51, at: 0.09 },
  ]);
}
