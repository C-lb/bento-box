// The /transcribe source switcher (audio vs document) shares one upload card
// with two independent "a file is staged" flags, `hasFile` (audio) and
// `hasDocFile` (document). Each FileDrop's own visible name resets on mode
// switch because the two panels are keyed Fragments, but FileDrop only calls
// its onChange callback on drop/pick/clear, never on mount — so without an
// explicit reset here, a flag set in one mode silently survives a switch to
// the other, leaving Transcribe enabled over an empty, freshly-mounted drop
// zone (see task-10-report.md, Fix round 1).
//
// This function is the single point that must hold that invariant: a mode
// switch always clears both flags, regardless of the switch direction or
// prior state.
export interface FileStageState {
  hasFile: boolean;
  hasDocFile: boolean;
}

export function resetFileStageOnModeSwitch(_current: FileStageState, _next: "audio" | "document"): FileStageState {
  return { hasFile: false, hasDocFile: false };
}
