function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapDocument(title: string, body: string): Buffer {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 32px 16px; background: #f4f4f5; font-family: -apple-system, sans-serif; }
  .page { max-width: 960px; margin: 0 auto 24px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  .page img { display: block; width: 100%; height: auto; }
  .page + .page { margin-top: 24px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
  return Buffer.from(html, "utf8");
}

/** Wrap raster PNG page buffers into one self-contained HTML document. */
export function pagesToHtml(pages: Buffer[], title = "Document"): Buffer {
  if (pages.length === 0) throw new Error("No pages to export.");
  const body = pages
    .map((p) => `<div class="page"><img src="data:image/png;base64,${p.toString("base64")}" alt=""></div>`)
    .join("\n");
  return wrapDocument(title, body);
}

/** Wrap a single raster image buffer into a self-contained HTML document. */
export function imageToHtml(imageBuffer: Buffer, mime: string, title = "Image"): Buffer {
  const body = `<div class="page"><img src="data:${mime};base64,${imageBuffer.toString("base64")}" alt=""></div>`;
  return wrapDocument(title, body);
}
