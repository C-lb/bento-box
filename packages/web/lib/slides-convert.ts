import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { drive_v3 } from "googleapis";
import { authedDriveClient, googleAccessToken } from "./google/oauth";
import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

/** Google's Slides import cap: presentations over 100 MB won't convert. */
export const SLIDES_IMPORT_MAX = 100 * 1024 * 1024;

export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const SLIDES_MIME = "application/vnd.google-apps.presentation";

// A Slides conversion attempt resolves to one of four failure kinds so the
// route can react correctly:
//   - "not-connected" no usable Google credentials (never connected, or the
//                     grant was revoked). Remedy is Settings, not retrying.
//   - "too-large"     over Google's 100 MB Slides import cap. No provider on
//                     this chain can help; don't upload at all.
//   - "rejected"      Google looked at THIS deck and refused to import it —
//                     retrying won't change the answer.
//   - "unreachable"   network failure, rate limit, or quota — transient;
//                     worth retrying later.
export type SlidesFailKind = "not-connected" | "too-large" | "rejected" | "unreachable";
export type SlidesConvertOutcome =
  | { ok: true; pdf: Buffer }
  | { ok: false; kind: SlidesFailKind; error: string };

export const SLIDES_MSG = {
  notConnected: "Google isn't connected. Connect Google in Settings to convert without LibreOffice.",
  tooLarge: "This deck is over Google's 100 MB Slides import limit, so it can't be converted via Google Slides.",
  rejected: "Google Slides couldn't import this deck. It may use features Slides doesn't support — try re-exporting it from PowerPoint.",
  unreachable: "Couldn't reach Google Slides. Check your internet connection and try again.",
  throttled: "Google is rate-limiting requests right now. Wait a moment and try again.",
};

/** Ordered provider list for the slicer's conversion chain. */
export function converterPlan(
  sofficePresent: boolean,
  googleConnected: boolean,
): ("libreoffice" | "google-slides")[] {
  const plan: ("libreoffice" | "google-slides")[] = [];
  if (sofficePresent) plan.push("libreoffice");
  if (googleConnected) plan.push("google-slides");
  return plan;
}

/**
 * files.create params for the pptx→Slides import. The mimeType mismatch —
 * pptx media uploaded as a google-apps.presentation — is what triggers
 * Drive's conversion. The caller attaches `media.body` (a read stream);
 * keeping it out of here keeps this helper pure and assertable.
 */
export function slidesCreateParams(name: string): drive_v3.Params$Resource$Files$Create {
  return {
    requestBody: { name, mimeType: SLIDES_MIME },
    media: { mimeType: PPTX_MIME },
    supportsAllDrives: true,
    fields: "id",
  };
}

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: number | string; response?: { status?: number }; status?: number };
  const raw = e?.response?.status ?? e?.status ?? e?.code;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? (n as number) : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Is this googleapis error the files.export 10 MB payload cap? That one isn't
 * a real failure — the deck converted fine, the export is just too big for the
 * API — so the caller falls back to the docs.google.com export URL.
 */
export function isExportSizeLimit(err: unknown): boolean {
  const e = err as { errors?: { reason?: string }[] };
  if (e?.errors?.some((x) => x?.reason === "exportSizeLimitExceeded")) return true;
  return /exportSizeLimitExceeded/i.test(messageOf(err));
}

/** Map a googleapis/network error to an outcome kind + user-facing message. */
export function classifySlidesError(err: unknown): { kind: SlidesFailKind; error: string } {
  const status = statusOf(err);
  const msg = messageOf(err);
  if (status === 401 || /invalid_grant|invalid credentials/i.test(msg)) {
    return { kind: "not-connected", error: SLIDES_MSG.notConnected };
  }
  // 403/429 are quota and rate-limit responses — transient, not this deck's fault.
  if (status === 403 || status === 429) {
    return { kind: "unreachable", error: SLIDES_MSG.throttled };
  }
  // 4xx beyond that means Google understood the request and refused the import.
  if (status !== undefined && status >= 400 && status < 500) {
    return { kind: "rejected", error: SLIDES_MSG.rejected };
  }
  // 5xx, DNS failures, timeouts: never got a usable answer.
  return { kind: "unreachable", error: SLIDES_MSG.unreachable };
}

/** The undocumented-but-stable large-export URL files.export falls back to. */
export function slidesExportUrl(fileId: string): string {
  return `https://docs.google.com/presentation/d/${fileId}/export/pdf`;
}

// Injection seam for tests: a drive client and bearer token supplied directly
// instead of being derived from the db, so unit tests never touch the network.
export type SlidesConvertDeps = {
  drive?: drive_v3.Drive;
  accessToken?: string;
};

/**
 * Convert a .pptx to PDF via the user's Google account: import it as a temp
 * Slides doc, export that to PDF, delete the temp doc. files.export hard-caps
 * payloads at 10 MB, so bigger PDFs are fetched from the docs.google.com
 * export URL with the OAuth bearer token instead.
 */
export async function convertViaGoogleSlides(
  pptxPath: string,
  db: Db,
  deps: SlidesConvertDeps = {},
): Promise<SlidesConvertOutcome> {
  let size: number;
  try {
    size = (await stat(pptxPath)).size;
  } catch (err) {
    // Missing/unreadable input stays inside the outcome type — callers chain
    // providers on {ok:false} and must not have to catch here.
    return { ok: false, ...classifySlidesError(err) };
  }
  if (size > SLIDES_IMPORT_MAX) return { ok: false, kind: "too-large", error: SLIDES_MSG.tooLarge };

  const drive = deps.drive ?? (await authedDriveClient(db));
  if (!drive) return { ok: false, kind: "not-connected", error: SLIDES_MSG.notConnected };

  let fileId: string | undefined;
  try {
    const created = await drive.files.create({
      ...slidesCreateParams(basename(pptxPath)),
      media: { mimeType: PPTX_MIME, body: createReadStream(pptxPath) },
    });
    fileId = created.data.id ?? undefined;
    if (!fileId) return { ok: false, kind: "rejected", error: SLIDES_MSG.rejected };

    try {
      const res = await drive.files.export(
        { fileId, mimeType: "application/pdf" },
        { responseType: "arraybuffer" },
      );
      return { ok: true, pdf: Buffer.from(res.data as ArrayBuffer) };
    } catch (err) {
      if (!isExportSizeLimit(err)) throw err;
      // Converted fine, PDF just exceeds the files.export 10 MB cap — pull it
      // from the export URL, which serves large payloads.
      const token = deps.accessToken ?? (await googleAccessToken(db))?.token;
      if (!token) return { ok: false, kind: "not-connected", error: SLIDES_MSG.notConnected };
      const res = await fetch(slidesExportUrl(fileId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return classifyFetchStatus(res.status);
      return { ok: true, pdf: Buffer.from(await res.arrayBuffer()) };
    }
  } catch (err) {
    return { ok: false, ...classifySlidesError(err) };
  } finally {
    if (fileId) {
      // The temp Slides doc must not accumulate in the user's Drive; but a
      // failed delete must never mask the conversion result.
      await drive.files
        .delete({ fileId, supportsAllDrives: true })
        .catch((err) => console.warn("slides-convert: temp file cleanup failed:", messageOf(err)));
    }
  }
}

function classifyFetchStatus(status: number): SlidesConvertOutcome {
  return { ok: false, ...classifySlidesError({ status }) };
}
