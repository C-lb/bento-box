import { resolve } from "node:path";

export function publicUrl(): string {
  return process.env.EE_PUBLIC_URL ?? "http://localhost:3000";
}

export function thumbsDir(): string {
  return process.env.EE_THUMBS_DIR ?? "data/thumbs";
}

export function fontPath(): string {
  return process.env.EE_FONT_PATH ?? resolve(process.cwd(), "assets/fonts/DMSans-Medium.ttf");
}
