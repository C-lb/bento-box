import { dirname } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export function run(bin: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const proc = spawn(bin, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", rej);
    proc.on("close", (code) =>
      code === 0 ? res(out) : rej(new Error(err.trim() || `${bin} exited ${code}`)),
    );
  });
}

export function ffmpegBin(): string {
  if (!ffmpegPath) throw new Error("bundled ffmpeg not found");
  return ffmpegPath;
}
export function ffmpegDir(): string {
  return dirname(ffmpegBin());
}
