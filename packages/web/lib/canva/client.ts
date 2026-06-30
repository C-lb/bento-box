// packages/web/lib/canva/client.ts
import type { openDb } from "@event-editor/core/db";
import { getToken, saveToken } from "@event-editor/core/tokens";
import { withBackoff } from "../backoff";
import { CanvaError, refreshToken } from "./oauth";

const BASE = "https://api.canva.com/rest/v1";
type Db = ReturnType<typeof openDb>;

export type CanvaDataset = { fields: { name: string; type: string }[] };
export type AutofillData = Record<
  string,
  { type: "text"; text: string } | { type: "image"; asset_id: string }
>;

export interface CanvaClient {
  listBrandTemplates(): Promise<{ id: string; title: string }[]>;
  getDataset(templateId: string): Promise<CanvaDataset>;
  uploadAsset(bytes: Buffer, name: string): Promise<string>;
  createAutofill(templateId: string, data: AutofillData): Promise<string>;
  exportPng(designId: string): Promise<string>;
  download(url: string): Promise<Buffer>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeCanvaClient(db: Db): CanvaClient {
  async function token(): Promise<string> {
    const stored = getToken(db, "canva");
    if (!stored) throw new CanvaError("Canva is not connected", 401);
    if (stored.expiryMs && stored.expiryMs < Date.now() + 30_000 && stored.refreshToken) {
      const fresh = await refreshToken(stored.refreshToken);
      saveToken(db, "canva", fresh);
      return fresh.accessToken;
    }
    return stored.accessToken;
  }

  async function call(path: string, init: RequestInit = {}, isRetry = false): Promise<any> {
    const at = await token();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${at}`, ...(init.headers ?? {}) },
    });
    if (res.status === 401 && !isRetry) {
      const stored = getToken(db, "canva");
      if (stored?.refreshToken) {
        saveToken(db, "canva", await refreshToken(stored.refreshToken));
        return call(path, init, true);
      }
    }
    if (!res.ok) {
      const retryAfter = Number((res as any).headers?.get?.("retry-after")) || undefined;
      throw new CanvaError(`canva ${init.method ?? "GET"} ${path} -> ${res.status}`, res.status, retryAfter);
    }
    return res.json();
  }

  // poll a job endpoint until success|failed; returns the extracted value
  async function pollJob(path: string, extract: (job: any) => unknown): Promise<unknown> {
    for (let i = 0; i < 60; i++) {
      const body = await withBackoff(() => call(path), { retryOn: (s) => s === 429 || (s ?? 0) >= 500 });
      const job = body.job ?? body;
      if (job.status === "success") return extract(job);
      if (job.status === "failed") {
        throw new CanvaError(job.error?.message ?? "canva job failed", 422);
      }
      await sleep(2000);
    }
    throw new CanvaError("canva job timed out", 504);
  }

  const jpost = (path: string, body: unknown) =>
    withBackoff(
      () => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      { retryOn: (s) => s === 429 || (s ?? 0) >= 500 },
    );

  return {
    async listBrandTemplates() {
      const body = await withBackoff(() => call("/brand-templates"), { retryOn: (s) => s === 429 || (s ?? 0) >= 500 });
      return (body.items ?? []).map((t: any) => ({ id: t.id, title: t.title ?? "(untitled)" }));
    },

    async getDataset(templateId) {
      const body = await call(`/brand-templates/${templateId}/dataset`);
      const dataset = body.dataset ?? body;
      const fields = Object.entries(dataset ?? {}).map(([name, def]: [string, any]) => ({
        name,
        type: def?.type ?? "unknown",
      }));
      return { fields };
    },

    async uploadAsset(bytes, name) {
      const meta = Buffer.from(name).toString("base64");
      const created = await withBackoff(
        () =>
          call("/asset-uploads", {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "Asset-Upload-Metadata": JSON.stringify({ name_base64: meta }),
            },
            body: bytes as any,
          }),
        { retryOn: (s) => s === 429 || (s ?? 0) >= 500 },
      );
      const jobId = (created.job ?? created).id;
      return (await pollJob(`/asset-uploads/${jobId}`, (j) => j.asset?.id ?? j.result?.asset?.id)) as string;
    },

    async createAutofill(templateId, data) {
      const created = await jpost("/autofills", { brand_template_id: templateId, data });
      const jobId = (created.job ?? created).id;
      return (await pollJob(`/autofills/${jobId}`, (j) => j.result?.design?.id ?? j.design?.id)) as string;
    },

    async exportPng(designId) {
      const created = await jpost("/exports", { design_id: designId, format: { type: "png" } });
      const jobId = (created.job ?? created).id;
      return (await pollJob(`/exports/${jobId}`, (j) => (j.urls ?? j.result?.urls ?? [])[0])) as string;
    },

    async download(url) {
      const res = await fetch(url);
      if (!res.ok) throw new CanvaError(`download ${res.status}`, res.status);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
