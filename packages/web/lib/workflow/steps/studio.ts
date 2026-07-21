import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { headshots } from "@event-editor/core/schema";
import { createBatchHeadshots } from "@event-editor/core/headshot";
import { getDb } from "@/lib/db";
import { runBatch } from "@/lib/batch";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { pollUntilTerminal } from "./poll.js";
import type { StepAdapter } from "../types.js";

export interface StudioInput {
  rows: { driveFileId: string; nameText: string; titleText: string }[];
  styleId: string;
}

export interface StudioParams {
  renderer: "local" | "canva";
}

export interface StudioOutput {
  batchId: string;
  ids: number[];
}

export const studioStep: StepAdapter<StudioInput, StudioParams, StudioOutput> = {
  inputKind: "none",
  outputKind: "headshot-batch",
  paramsSchema: {
    type: "object",
    properties: { renderer: { type: "string", enum: ["local", "canva"] } },
    required: ["renderer"],
    additionalProperties: false,
  },
  async run(input, params) {
    const db = getDb();
    const drive = await authedDriveClient(db);
    if (!drive) throw new Error("Google is not connected. Re-auth on /settings.");
    const batchId = randomBytes(8).toString("hex");
    const ids = createBatchHeadshots(db, {
      batchId,
      renderer: params.renderer,
      styleId: input.styleId,
      rows: input.rows,
    });
    runBatch(db, makeDriveClient(drive), params.renderer, ids);

    const rows = await Promise.all(
      ids.map((id) =>
        pollUntilTerminal(
          () => db.select().from(headshots).where(eq(headshots.id, id)).all()[0],
          (r) => r.status === "done" || r.status === "error",
        ),
      ),
    );
    const failed = rows.filter((r) => r.status === "error");
    if (failed.length > 0) {
      const detail = failed.map((r) => r.errorMessage ?? `id ${r.id}`).join("; ");
      throw new Error(`${failed.length} of ${rows.length} headshots failed: ${detail}`);
    }
    return { batchId, ids };
  },
};
