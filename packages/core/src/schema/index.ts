import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  driveFolderId: text("drive_folder_id").notNull(),
  driveFolderName: text("drive_folder_name").notNull(),
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
  source: text("source").notNull(), // sorter|upload
  sourcePhotoId: integer("source_photo_id").references(() => photos.id),
  sourceUploadPath: text("source_upload_path"),
  canvaTemplateId: text("canva_template_id").notNull(),
  nameText: text("name_text"),
  titleText: text("title_text"),
  autofillJobId: text("autofill_job_id"),
  designId: text("design_id"),
  status: text("status").notNull().default("autofilling"), // autofilling|exporting|done|error
  exportUrl: text("export_url"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});
