import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  driveFolderId: text("drive_folder_id").notNull(),
  driveFolderName: text("drive_folder_name").notNull(),
  platform: text("platform"),
  status: text("status").notNull(), // scanning|heuristics|ranking|done|error
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull().references(() => jobs.id),
  driveFileId: text("drive_file_id").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  thumbnailPath: text("thumbnail_path"),
  width: integer("width"),
  height: integer("height"),
  sharpness: real("sharpness"),
  brightness: real("brightness"),
  aspectRatio: real("aspect_ratio"),
  faceCount: integer("face_count"),
  stage: text("stage").notNull().default("pending"), // pending|rejected|ranked|errored
  rejectReason: text("reject_reason"),
  errorMessage: text("error_message"),
  score: integer("score"),
  reasons: text("reasons", { mode: "json" }).$type<string[]>(),
  rank: integer("rank"),
});

export const headshots = sqliteTable("headshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(), // drive|upload|sorter
  sourcePhotoId: integer("source_photo_id").references(() => photos.id),
  sourceUploadPath: text("source_upload_path"),
  sourceDriveFileId: text("source_drive_file_id"),
  renderer: text("renderer").notNull().default("local"), // local|canva
  canvaTemplateId: text("canva_template_id"), // nullable now (canva path only)
  templateId: text("template_id"), // generic frame id, e.g. clean-band
  nameText: text("name_text"),
  titleText: text("title_text"),
  autofillJobId: text("autofill_job_id"),
  designId: text("design_id"),
  status: text("status").notNull().default("rendering"), // rendering|autofilling|exporting|done|error
  outputPath: text("output_path"),
  exportUrl: text("export_url"),
  errorMessage: text("error_message"),
  batchId: text("batch_id"),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
  provider: text("provider").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiryMs: integer("expiry_ms"),
  scope: text("scope"),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const transcriptions = sqliteTable("transcriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalFilename: text("original_filename").notNull(),
  sourceUploadPath: text("source_upload_path").notNull(),
  durationSec: real("duration_sec"),
  status: text("status").notNull().default("uploading"), // uploading|transcribing|summarizing|creating_doc|done|error
  transcriptText: text("transcript_text"),
  summaryText: text("summary_text"),
  docId: text("doc_id"),
  docUrl: text("doc_url"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
  contextFilePath: text("context_file_path"),
  contextText: text("context_text"),
  eventDetails: text("event_details"),
  summaryLinkedin: text("summary_linkedin"),
  summaryArticle: text("summary_article"),
  transcriptSegments: text("transcript_segments"), // JSON MergedSegment[] so the doc can be rebuilt later
});

export const styleExamples = sqliteTable("style_examples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  format: text("format").notNull(), // linkedin|article
  kind: text("kind").notNull(),     // seed|custom|liked
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull().default(0),
});

export const rankingContexts = sqliteTable("ranking_contexts", {
  platform: text("platform").primaryKey(),
  text: text("text").notNull(),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const sliceRuns = sqliteTable("slice_runs", {
  runId: text("run_id").primaryKey(),
  sourceFilename: text("source_filename").notNull(),
  status: text("status").notNull(), // converted|sliced
  createdAt: integer("created_at").notNull().default(0),
});

// One row per converted HEIC photo. batch_id groups the files from a single
// "Convert all" run so history can bundle a batch and show singles on their own.
export const heicConversions = sqliteTable("heic_conversions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: text("batch_id").notNull(),
  jobId: text("job_id").notNull(),
  sourceFilename: text("source_filename").notNull(),
  outFilename: text("out_filename").notNull(),
  outFormat: text("out_format").notNull(),
  createdAt: integer("created_at").notNull().default(0),
});
