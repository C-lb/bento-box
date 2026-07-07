// scripts/server-smoke.mjs — real-file round trips against a running Bento server.
// Usage: node scripts/server-smoke.mjs [baseUrl]   (default http://localhost:3000)
//
// Every route here does its work synchronously inside the POST handler and
// returns the final result in the response body — there is no async job
// queue anywhere in this app, so there is nothing to poll. Each check does a
// real POST round trip and then a real GET download of the produced file.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
const JSZip = require("jszip");
const { PDFDocument } = require("pdf-lib");

const BASE = process.argv[2] ?? "http://localhost:3000";
const dir = mkdtempSync(join(tmpdir(), "bento-smoke-"));
const results = [];

function fixtureVideo() {
  const p = join(dir, "in.mp4");
  execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", p], { stdio: "ignore" });
  return p;
}
function fixturePng() {
  const p = join(dir, "in.png");
  execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=duration=0.1:size=640x480:rate=1",
    "-frames:v", "1", p], { stdio: "ignore" });
  return p;
}
async function fixturePdf() {
  const p = join(dir, "in.pdf");
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText("smoke", { x: 50, y: 100 });
  writeFileSync(p, await doc.save());
  return p;
}
async function fixturePptx() {
  // Minimal single-slide pptx: content types + package rels + presentation +
  // one slide master + one slide layout + one slide, each with its own rels.
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);
  zip.file("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);
  zip.file("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
</p:spTree>
</p:cSld>
</p:sldLayout>`);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr/><a:p><a:r><a:t>Smoke Test Slide</a:t></a:r></a:p></p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
</p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);
  const p = join(dir, "in.pptx");
  writeFileSync(p, await zip.generateAsync({ type: "nodebuffer" }));
  return p;
}

async function post(label, path, field, filePath, extra = {}) {
  try {
    const form = new FormData();
    form.set(field, new Blob([readFileSync(filePath)]), filePath.split("/").pop());
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    results.push({ label, pass: res.ok, detail: res.ok ? "" : `${res.status} ${body.error ?? ""}` });
    return res.ok ? body : null;
  } catch (err) {
    results.push({ label, pass: false, detail: String(err) });
    return null;
  }
}
async function download(label, path) {
  try {
    const res = await fetch(`${BASE}${path}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    results.push({ label, pass: res.ok && buf.length > 0, detail: res.ok ? `${buf.length}B` : `${res.status}` });
  } catch (err) {
    results.push({ label, pass: false, detail: String(err) });
  }
}

// 1. health + binaries
const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
for (const d of health.deps) results.push({ label: `dep:${d.id}`, pass: d.ready, detail: d.version ?? "" });

// 2. convert (file -> mp3): POST /api/convert/file {file} -> {id, filename}, synchronous.
const conv = await post("convert:upload", "/api/convert/file", "file", fixtureVideo());
if (conv?.id) await download("convert:download", `/api/convert/${conv.id}?name=${encodeURIComponent(conv.filename)}`);

// 3. resize: POST /api/resize {file, maxW} -> {id, ext, ...}, synchronous.
const rsz = await post("resize", "/api/resize", "file", fixturePng(), { maxW: "320" });
if (rsz?.id) await download("resize:download", `/api/resize/${rsz.id}?ext=${rsz.ext}`);

// 4. pdf compress: POST /api/pdf/process/compress {file} -> {id, filename, kind: "pdf"}, synchronous.
const pdf = await post("pdf:compress", "/api/pdf/process/compress", "file", await fixturePdf());
if (pdf?.id) await download("pdf:download", `/api/pdf/file/${pdf.id}?kind=pdf`);

// 5. video (transcode): POST /api/video {file, preset} -> {id, filename, ...}, synchronous.
//    preset must be one of "smaller" | "balanced" | "quality".
const vid = await post("video", "/api/video", "file", fixtureVideo(), { preset: "smaller" });
if (vid?.id) await download("video:download", `/api/video/${vid.id}?name=${encodeURIComponent(vid.filename)}`);

// 6. splice (two-clip join): POST /api/splice needs one "file" part per clip plus a
//    JSON "manifest" field {kind, scale, clips[]} with clips.length === files.length.
const splMan = JSON.stringify({
  kind: "video",
  scale: "match",
  clips: [{ start: 0, end: 1, volume: 1 }, { start: 0, end: 1, volume: 1 }],
});
const splRes = await (async () => {
  try {
    const clipPath = fixtureVideo();
    const form = new FormData();
    form.append("file", new Blob([readFileSync(clipPath)]), "clip1.mp4");
    form.append("file", new Blob([readFileSync(clipPath)]), "clip2.mp4");
    form.set("manifest", splMan);
    const res = await fetch(`${BASE}/api/splice`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    results.push({ label: "splice:upload", pass: res.ok, detail: res.ok ? "" : `${res.status} ${body.error ?? ""}` });
    return res.ok ? body : null;
  } catch (err) {
    results.push({ label: "splice:upload", pass: false, detail: String(err) });
    return null;
  }
})();
if (splRes?.id) await download("splice:download", `/api/splice/${splRes.id}?kind=${splRes.kind}`);

// 7. slice (pptx -> pdf via LibreOffice): POST /api/slice/convert takes the raw pptx
//    bytes as the request body (NOT multipart) plus an "x-filename" header.
await (async () => {
  try {
    const pptxPath = await fixturePptx();
    const res = await fetch(`${BASE}/api/slice/convert`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-filename": "in.pptx" },
      body: readFileSync(pptxPath),
    });
    const body = await res.json().catch(() => ({}));
    results.push({ label: "slice:convert", pass: res.ok, detail: res.ok ? `${body.pageCount ?? "?"}pg` : `${res.status} ${body.error ?? ""}` });
  } catch (err) {
    results.push({ label: "slice:convert", pass: false, detail: String(err) });
  }
})();

// report
const w = Math.max(...results.map((r) => r.label.length));
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label.padEnd(w)}  ${r.detail}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
