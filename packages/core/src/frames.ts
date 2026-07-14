export type CropShape = "rect" | "circle";

export interface TextLine {
  x: number;
  y: number; // top of the text box
  size: number;
  color: string;
  anchor: "left" | "center";
}

export interface FrameSpec {
  id: string;
  label: string;
  canvas: number;
  bg: string;
  photo: { x: number; y: number; w: number; h: number; shape: CropShape };
  band?: { x: number; y: number; w: number; h: number; fill: string };
  plate?: { x: number; y: number; w: number; h: number; rx: number; fill: string };
  accent?: { x: number; y: number; w: number; h: number; fill: string };
  name: TextLine;
  title: TextLine;
}

/** Per-line text overrides. Any absent field falls back to the card-level
 *  style, then to the frame's own default for that line. */
export interface LineStyle {
  bold?: boolean;
  italic?: boolean;
  /** Cap height in px on the frame's own canvas; absent keeps the frame default. */
  size?: number;
  /** Letter-spacing in px; 0 (default) preserves kerning. */
  tracking?: number;
}

/** Circle-frame rim. Absent ⇒ no rim. */
export interface RimSpec {
  mode: "solid" | "gradient";
  /** Ring thickness in px on the frame canvas, clamped [2, 80]. */
  width: number;
  /** Solid mode colour, #rrggbb. */
  color?: string;
  /** Gradient stop 1, #rrggbb. */
  from?: string;
  /** Gradient stop 2, #rrggbb. */
  to?: string;
  /** Gradient direction in degrees, 0–360. */
  angle?: number;
}

/** Per-headshot caption + crop options chosen at generate time. All optional;
 *  an absent field keeps the frame's own default. The legacy top-level
 *  bold/italic/uppercase/color/zoom fields act as the card-level baseline; a
 *  matching per-line field overrides it. Old persisted cards that only set the
 *  legacy fields render exactly as before. */
export interface HeadshotStyle {
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  /** Overrides every line's colour when set. */
  color?: string | null;
  /** Head crop scale, 1 = frame default, up to 3 = tighter on the face. */
  zoom?: number;

  /** Designer-font registry id applied to the whole card, e.g. "inter". */
  fontId?: string;
  /** Optional third line; empty/absent ⇒ not drawn. */
  companyText?: string;
  name?: LineStyle;
  title?: LineStyle;
  company?: LineStyle;
  /** Extra px added between each text line (negative tightens). */
  lineGap?: number;
  /** Extra px between the photo and the first text line (shifts the whole
   *  text block down; negative moves it up toward the photo). */
  textOffsetY?: number;
  /** Pan, normalized -1..1 as a fraction of the available crop slack. */
  offsetX?: number;
  offsetY?: number;
  /** Circle-frame rim. */
  rim?: RimSpec;
  /** Export with a transparent background instead of the frame fill. */
  transparentBg?: boolean;
}

const ACCENT = "#2563eb";

export const FRAMES: Record<string, FrameSpec> = {
  "clean-band": {
    id: "clean-band",
    label: "Clean band",
    canvas: 1080,
    bg: "#ffffff",
    photo: { x: 0, y: 0, w: 1080, h: 1080, shape: "rect" },
    band: { x: 0, y: 842, w: 1080, h: 238, fill: "#1c1c1e" },
    accent: { x: 0, y: 839, w: 1080, h: 3, fill: ACCENT },
    name: { x: 64, y: 902, size: 52, color: "#ffffff", anchor: "left" },
    title: { x: 64, y: 974, size: 30, color: "#a1a1aa", anchor: "left" },
  },
  circle: {
    id: "circle",
    label: "Circle",
    canvas: 1080,
    bg: "#f5f5f4",
    photo: { x: 230, y: 120, w: 620, h: 620, shape: "circle" },
    name: { x: 540, y: 832, size: 52, color: "#18181b", anchor: "center" },
    title: { x: 540, y: 904, size: 30, color: "#71717a", anchor: "center" },
  },
  "minimal-corner": {
    id: "minimal-corner",
    label: "Minimal corner",
    canvas: 1080,
    bg: "#ffffff",
    photo: { x: 0, y: 0, w: 1080, h: 1080, shape: "rect" },
    plate: { x: 48, y: 880, w: 560, h: 152, rx: 20, fill: "#fffffff2" },
    name: { x: 84, y: 912, size: 46, color: ACCENT, anchor: "left" },
    title: { x: 84, y: 976, size: 28, color: "#52525b", anchor: "left" },
  },
};

export function getFrame(id: string): FrameSpec | undefined {
  return FRAMES[id];
}

export const FRAME_LIST: FrameSpec[] = Object.values(FRAMES);
