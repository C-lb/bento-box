import type { jobs, photos, headshots } from "./schema/index.js";

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type Headshot = typeof headshots.$inferSelect;
export type NewHeadshot = typeof headshots.$inferInsert;

export type JobStatus = "scanning" | "heuristics" | "ranking" | "done" | "error";
export type PhotoStage = "pending" | "rejected" | "ranked" | "errored";
export type HeadshotStatus = "autofilling" | "exporting" | "done" | "error";
