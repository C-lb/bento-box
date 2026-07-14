// Type stubs for packages that ship no TypeScript declarations.
declare module "ffprobe-static" {
  const ffprobeStatic: { path: string };
  export default ffprobeStatic;
}

declare module "text-to-svg" {
  interface GetPathOptions {
    x?: number;
    y?: number;
    fontSize?: number;
    anchor?: string;
    attributes?: Record<string, string>;
  }
  interface Metrics {
    x: number;
    y: number;
    baseline: number;
    width: number;
    height: number;
    ascender: number;
    descender: number;
  }
  export default class TextToSVG {
    static loadSync(file?: string): TextToSVG;
    getPath(text: string, options?: GetPathOptions): string;
    getWidth(text: string, options?: GetPathOptions): number;
    getMetrics(text: string, options?: GetPathOptions): Metrics;
  }
}
