import QRCode from "qrcode";
import type { QrEcc, QrFormat } from "@event-editor/core/qr";

export interface QrGenOpts {
  size: number;
  ecc: QrEcc;
  fg: string;
  bg: string;
  format: QrFormat;
}

export async function generateQrBuffer(text: string, opts: QrGenOpts): Promise<Buffer> {
  if (opts.format === "svg") {
    const svg = await QRCode.toString(text, {
      type: "svg",
      width: opts.size,
      errorCorrectionLevel: opts.ecc,
      color: { dark: opts.fg, light: opts.bg },
    });
    return Buffer.from(svg, "utf8");
  }
  const dataUrl = await QRCode.toDataURL(text, {
    width: opts.size,
    errorCorrectionLevel: opts.ecc,
    color: { dark: opts.fg, light: opts.bg },
  });
  const base64 = dataUrl.split(",")[1] ?? "";
  return Buffer.from(base64, "base64");
}
