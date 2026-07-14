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

/** Per-headshot caption + crop options chosen at generate time. All optional;
 *  an absent field keeps the frame's own default. */
export interface HeadshotStyle {
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  /** Overrides both name and title colour when set. */
  color?: string | null;
  /** Head crop scale, 1 = frame default, up to 3 = tighter on the face. */
  zoom?: number;
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
