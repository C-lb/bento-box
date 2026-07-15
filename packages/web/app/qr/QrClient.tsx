"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { SnapSlider } from "@/components/SnapSlider";
import { normalizeQrOpts, type QrEcc, type QrFormat } from "@event-editor/core/qr";
import { historyWhen } from "@/components/HistoryPanel";
import {
  addQrHistoryItem,
  clearQrHistory,
  newQrHistoryId,
  readQrHistory,
  removeQrHistoryItem,
  writeQrHistory,
  type QrHistoryItem,
} from "@/lib/qr-history";

function truncateText(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function QrClient() {
  const [text, setText] = useState("");
  const [size, setSize] = useState(512);
  const [ecc, setEcc] = useState<QrEcc>("M");
  const [fg, setFg] = useState("#000000");
  const [bg, setBg] = useState("#ffffff");
  const [format, setFormat] = useState<QrFormat>("png");

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [svgDownloadUrl, setSvgDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<QrHistoryItem[]>([]);

  useEffect(() => {
    setHistory(readQrHistory().items);
  }, []);

  // The QR regenerates live on every keystroke, so recording per generate would
  // fill the history with partial text. Record at the download click instead:
  // that is the moment a real code left the tool.
  function recordDownload() {
    const opts = normalizeQrOpts({ size, ecc, fg, bg, format });
    const next = addQrHistoryItem(readQrHistory(), {
      id: newQrHistoryId(),
      text,
      at: Date.now(),
      ...opts,
    });
    writeQrHistory(next);
    setHistory(next.items);
  }

  function applyHistoryItem(item: QrHistoryItem) {
    setText(item.text);
    setSize(item.size);
    setEcc(item.ecc);
    setFg(item.fg);
    setBg(item.bg);
    setFormat(item.format);
    // Regeneration happens automatically: the preview effect keys off the form state.
  }

  function removeHistoryItem(id: string) {
    const next = removeQrHistoryItem(readQrHistory(), id);
    writeQrHistory(next);
    setHistory(next.items);
  }

  function handleClearHistory() {
    clearQrHistory();
    setHistory([]);
  }

  useEffect(() => {
    const opts = normalizeQrOpts({ size, ecc, fg, bg, format });
    setError(null);

    if (!text.trim()) {
      setDataUrl(null);
      setSvg(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        if (opts.format === "png") {
          const url = await QRCode.toDataURL(text, {
            width: opts.size,
            errorCorrectionLevel: opts.ecc,
            color: { dark: opts.fg, light: opts.bg },
          });
          if (!cancelled) {
            setDataUrl(url);
            setSvg(null);
          }
        } else {
          const svgString = await QRCode.toString(text, {
            type: "svg",
            width: opts.size,
            errorCorrectionLevel: opts.ecc,
            color: { dark: opts.fg, light: opts.bg },
          });
          if (!cancelled) {
            setSvg(svgString);
            setDataUrl(null);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [text, size, ecc, fg, bg, format]);

  // Build a fresh object URL for the SVG download whenever the SVG changes, and
  // revoke the previous one so we don't leak blob URLs.
  useEffect(() => {
    if (!svg) {
      setSvgDownloadUrl(null);
      return;
    }
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    setSvgDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [svg]);

  const hasPreview = format === "png" ? !!dataUrl : !!svg;

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <label className="block text-sm font-medium">Text or URL
          <input
            className="field mt-1 min-h-[44px] sm:min-h-0"
            placeholder="https://..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        <div className="mt-4">
          <SnapSlider
            label="Size"
            value={size}
            onChange={setSize}
            min={128}
            max={1024}
            step={8}
            checkpoints={[128, 256, 512, 1024]}
            format={(v) => `${v}px`}
            editable
          />
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium">Error correction</p>
          <div className="mt-1">
            <Segmented
              options={[
                { value: "L", label: "L" },
                { value: "M", label: "M" },
                { value: "Q", label: "Q" },
                { value: "H", label: "H" },
              ]}
              value={ecc}
              onChange={(v) => setEcc(v as QrEcc)}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm font-medium">
            Foreground
            <input
              type="color"
              value={fg}
              onChange={(e) => setFg(e.target.value)}
              className="h-8 w-12 rounded-md border-0"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            Background
            <input
              type="color"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              className="h-8 w-12 rounded-md border-0"
            />
          </label>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium">Format</p>
          <div className="mt-1">
            <Segmented
              options={[
                { value: "png", label: "PNG" },
                { value: "svg", label: "SVG" },
              ]}
              value={format}
              onChange={(v) => setFormat(v as QrFormat)}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      <div className="card">
        {!text.trim() && (
          <p className="text-sm text-muted">Enter some text or a URL to see a preview.</p>
        )}

        {text.trim() && hasPreview && (
          <div className="space-y-4">
            <div className="flex items-center justify-center rounded-lg bg-white p-4">
              {format === "png" && dataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dataUrl} alt="QR code preview" className="max-w-full" />
              )}
              {format === "svg" && svg && (
                <div
                  className="max-w-full [&_svg]:h-auto [&_svg]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {format === "png" && dataUrl && (
                <a className="btn btn-accent inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto" href={dataUrl} download="qr.png" onClick={recordDownload}>
                  <Download className="w-4 h-4" strokeWidth={1.75} /> Download PNG
                </a>
              )}
              {format === "svg" && svgDownloadUrl && (
                <a className="btn btn-accent inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto" href={svgDownloadUrl} download="qr.svg" onClick={recordDownload}>
                  <Download className="w-4 h-4" strokeWidth={1.75} /> Download SVG
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        {history.length > 0 ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">See past QR codes</p>
              <button
                type="button"
                className="btn min-h-[44px] sm:min-h-0"
                onClick={handleClearHistory}
              >
                Clear all
              </button>
            </div>
            <ul className="mt-3 space-y-3">
              {history.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-t border-black/5 pt-3 first:border-t-0 first:pt-0"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => applyHistoryItem(item)}
                    title="Fill the form with this code"
                  >
                    <span className="block truncate text-sm font-medium text-ink">
                      {truncateText(item.text)}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {historyWhen(item.at)} · {item.size}px · {item.format.toUpperCase()}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="p-2 -m-2 min-h-[44px] sm:min-h-0 sm:p-0 sm:m-0 text-xs text-danger underline underline-offset-2"
                    onClick={() => removeHistoryItem(item.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">Past QR codes appear here after you download.</p>
        )}
      </div>
    </div>
  );
}
