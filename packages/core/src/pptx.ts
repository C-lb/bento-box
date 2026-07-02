export interface SlideText { index: number; text: string; notes: string }
export interface SpeakerGroup { speaker: string; startSlide: number; endSlide: number }

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Pull all <a:t> text runs out of a slide/notes XML string. */
export function slideTextFromXml(xml: string): string {
  const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

/** ppt/slides/slide12.xml -> 12. Non-slide files (rels etc.) -> null. */
export function slideNumberFromPath(path: string): number | null {
  const m = path.match(/(?:^|\/)slide(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Order slide XML paths by their numeric slide index. */
export function orderSlidePaths(paths: string[]): string[] {
  return paths
    .filter((p) => slideNumberFromPath(p) !== null)
    .sort((a, b) => (slideNumberFromPath(a)! - slideNumberFromPath(b)!));
}

/** Prompt asking Claude to group contiguous slides by speaker. */
export function buildSpeakerSegmentPrompt(slides: SlideText[]): string {
  const body = slides
    .map((s) => {
      const notes = s.notes ? `\n  Notes: ${s.notes}` : "";
      return `Slide ${s.index}: ${s.text || "(no visible text)"}${notes}`;
    })
    .join("\n");
  return [
    "You are segmenting a slide deck into each speaker's contiguous portion.",
    "Read the slide text and speaker notes below. Group consecutive slides that belong to the same speaker into one portion.",
    "Rules:",
    "- Portions must be contiguous and non-overlapping, covering slides 1 to " + slides.length + " in order.",
    "- Use the speaker's name when it is clear; otherwise use a short descriptive label (for example \"Opening\", \"Panel\").",
    "- Return startSlide and endSlide as 1-based slide numbers.",
    "",
    body,
  ].join("\n");
}

/** Prompt asking Claude to group contiguous slides into distinct topic sections. */
export function buildTopicSegmentPrompt(slides: SlideText[]): string {
  const body = slides
    .map((s) => {
      const notes = s.notes ? `\n  Notes: ${s.notes}` : "";
      return `Slide ${s.index}: ${s.text || "(no visible text)"}${notes}`;
    })
    .join("\n");
  return [
    "You are segmenting a slide deck into its distinct topic sections.",
    "Read the slide text and speaker notes below. Group consecutive slides that cover the same topic into one section.",
    "Rules:",
    "- Sections must be contiguous and non-overlapping, covering slides 1 to " + slides.length + " in order.",
    "- Label each section with a short topic title (for example \"Market overview\", \"Q and A\").",
    "- Return startSlide and endSlide as 1-based slide numbers.",
    "",
    body,
  ].join("\n");
}

/** Clamp AI-proposed groups to the slide range, fix reversed bounds, order, and name blanks. */
export function normalizeSpeakerGroups(groups: SpeakerGroup[], slideCount: number, labelPrefix = "Speaker"): SpeakerGroup[] {
  const clamp = (n: number) => Math.max(1, Math.min(Math.round(n), slideCount));
  const out = groups.map((g) => {
    let s = clamp(g.startSlide);
    let e = clamp(g.endSlide);
    if (s > e) [s, e] = [e, s];
    return { speaker: g.speaker.trim(), startSlide: s, endSlide: e };
  });
  out.sort((a, b) => a.startSlide - b.startSlide);
  return out.map((g, i) => ({ ...g, speaker: g.speaker || `${labelPrefix} ${i + 1}` }));
}
