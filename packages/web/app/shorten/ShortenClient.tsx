"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { CopyButton } from "@/components/CopyButton";
import { validateLongUrl, validateCustomName, type ShortenService } from "@/lib/shorten";
import {
  addShortenHistoryItem,
  clearShortenHistory,
  readShortenHistory,
  writeShortenHistory,
  type ShortenHistoryItem,
} from "@/lib/shorten-history";

function truncateUrl(url: string, max = 48): string {
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

export function ShortenClient() {
  const [longUrl, setLongUrl] = useState("");
  const [custom, setCustom] = useState("");
  const [service, setService] = useState<ShortenService>("is.gd");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const [history, setHistory] = useState<ShortenHistoryItem[]>([]);

  useEffect(() => {
    setHistory(readShortenHistory().items);
  }, []);

  const longUrlError = longUrl ? validateLongUrl(longUrl) : null;
  const customError = custom ? validateCustomName(custom) : null;

  useEffect(() => {
    if (!shortUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(shortUrl, { width: 200 });
        if (!cancelled) setQrDataUrl(url);
      } catch {
        if (!cancelled) setQrDataUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shortUrl]);

  async function handleShorten() {
    const urlErr = validateLongUrl(longUrl);
    const nameErr = validateCustomName(custom);
    if (urlErr || nameErr) {
      setError(urlErr ?? nameErr);
      return;
    }

    setBusy(true);
    setError(null);
    setShortUrl(null);

    try {
      const res = await fetch("/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: longUrl.trim(),
          custom: custom.trim() || undefined,
          service,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setShortUrl(data.shorturl);
      const next = addShortenHistoryItem(readShortenHistory(), {
        long: longUrl.trim(),
        short: data.shorturl,
        at: Date.now(),
      });
      writeShortenHistory(next);
      setHistory(next.items);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleClearHistory() {
    clearShortenHistory();
    setHistory([]);
  }

  const canSubmit = !!longUrl.trim() && !longUrlError && !customError && !busy;

  return (
    <div className="mt-8 space-y-5">
      <div className="card">
        <label className="block text-sm font-medium">
          Link to shorten
          <input
            className="field mt-1 min-h-[44px] sm:min-h-0"
            placeholder="https://..."
            value={longUrl}
            onChange={(e) => setLongUrl(e.target.value)}
          />
        </label>
        {longUrlError && <p className="mt-1 text-sm text-danger">{longUrlError}</p>}

        <div className="mt-4">
          <label className="block text-sm font-medium">
            Custom name (optional)
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-muted">{service}/</span>
              <input
                className="field min-h-[44px] sm:min-h-0"
                placeholder="my-link"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          </label>
          {customError && <p className="mt-1 text-sm text-danger">{customError}</p>}
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium">Service</p>
          <div className="mt-1">
            <Segmented
              options={[
                { value: "is.gd", label: "is.gd" },
                { value: "v.gd", label: "v.gd (shows a preview page)" },
              ]}
              value={service}
              onChange={(v) => setService(v as ShortenService)}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <button
          type="button"
          className="btn btn-accent mt-4 inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
          onClick={handleShorten}
          disabled={!canSubmit}
        >
          {busy ? "Shortening…" : "Shorten"}
        </button>
      </div>

      {shortUrl && (
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {qrDataUrl && (
              <div className="flex items-center justify-center rounded-lg bg-white p-3 self-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="QR code for shortened link" width={200} height={200} />
              </div>
            )}
            <div className="flex-1 space-y-3">
              <a
                href={shortUrl}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-sm font-medium text-accent"
              >
                {shortUrl}
              </a>
              <div className="flex flex-col sm:flex-row gap-3">
                <CopyButton text={shortUrl} />
                {qrDataUrl && (
                  <a
                    className="btn inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 w-full sm:w-auto"
                    href={qrDataUrl}
                    download="shorten-qr.png"
                  >
                    <Download className="w-4 h-4" strokeWidth={1.75} /> Download PNG
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">History</p>
            <button
              type="button"
              className="btn min-h-[44px] sm:min-h-0"
              onClick={handleClearHistory}
            >
              Clear history
            </button>
          </div>
          <ul className="mt-3 space-y-3">
            {history.map((item, i) => (
              <li
                key={`${item.short}-${item.at}-${i}`}
                className="flex items-center justify-between gap-3 border-t border-black/5 pt-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <a
                    href={item.short}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium text-accent"
                  >
                    {item.short}
                  </a>
                  <p className="truncate text-sm text-muted">{truncateUrl(item.long)}</p>
                </div>
                <CopyButton text={item.short} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
