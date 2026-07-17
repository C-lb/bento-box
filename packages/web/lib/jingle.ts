// Tiny two-note chime for adding a favourite. Synthesized (no asset), quiet,
// and fire-and-forget: any AudioContext failure (autoplay policy, no audio
// device) is swallowed so favouriting never breaks.
type Note = { freq: number; at: number };

function playNotes(notes: Note[], type: OscillatorType, release = 0.22): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    let end = 0;
    for (const { freq, at } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + release);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + release + 0.03);
      end = Math.max(end, at + release + 0.03);
    }
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, (end + 0.3) * 1000);
  } catch {
    // Sound is decoration; never let it throw into the click handler.
  }
}

/** E6 then A6: a bright rising plink for adding a favourite. */
export function playFavouriteJingle(): void {
  playNotes(
    [
      { freq: 1318.51, at: 0 },
      { freq: 1760.0, at: 0.09 },
    ],
    "triangle",
  );
}

/** G4 down to C4: a low, soft descending sine tone for removing a favourite.
    Deliberately a different register and timbre from the add chime. */
export function playUnfavouriteJingle(): void {
  playNotes(
    [
      { freq: 392.0, at: 0 },
      { freq: 261.63, at: 0.11 },
    ],
    "sine",
    0.3,
  );
}
