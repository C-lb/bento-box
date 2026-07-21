import { eq } from "drizzle-orm";
import { jobs } from "@event-editor/core/schema";
import { isPlatform } from "@event-editor/core/ranking-context";
import { getDb } from "@/lib/db";
import { startScan } from "@/lib/sorter";
import { authedDriveClient } from "@/lib/google/oauth";
import { makeDriveClient } from "@/lib/google/drive";
import { pollUntilTerminal } from "./poll";
import type { StepAdapter } from "../types";

export interface SorterInput {
  folderId: string;
  folderName: string;
  platform: string;
}

export interface SorterParams {
  includeSubfolders?: boolean;
}

export interface SorterOutput {
  jobId: number;
}

export const sorterStep: StepAdapter<SorterInput, SorterParams, SorterOutput> = {
  inputKind: "none",
  outputKind: "drive-ranked-list",
  paramsSchema: {
    type: "object",
    properties: { includeSubfolders: { type: "boolean" } },
    additionalProperties: false,
  },
  async run(input, params) {
    if (!isPlatform(input.platform)) throw new Error(`Unknown platform: ${input.platform}`);
    const db = getDb();
    const drive = await authedDriveClient(db);
    if (!drive) throw new Error("Google is not connected. Re-auth on /settings.");
    const jobId = startScan(db, makeDriveClient(drive), {
      folderId: input.folderId,
      folderName: input.folderName,
      platform: input.platform,
      includeSubfolders: params.includeSubfolders,
    });
    const row = await pollUntilTerminal(
      () => db.select().from(jobs).where(eq(jobs.id, jobId)).all()[0],
      (r) => r.status === "done" || r.status === "error",
    );
    if (row.status === "error") throw new Error(row.errorMessage ?? "Sorter job failed.");
    return { jobId };
  },
};
