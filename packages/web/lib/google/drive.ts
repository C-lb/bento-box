import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink: string | null;
}
export interface DriveFolder {
  id: string;
  name: string;
}
export interface DrivePresentation {
  id: string;
  name: string;
}
export interface DriveClient {
  listFolders(): Promise<DriveFolder[]>;
  listChildFolders(parentId: string): Promise<DriveFolder[]>;
  listSharedFolders(): Promise<DriveFolder[]>;
  searchFolders(term: string): Promise<DriveFolder[]>;
  listImages(folderId: string): Promise<DriveImage[]>;
  /** listImages, but also descends into every subfolder (breadth-first, deduped). */
  listImagesDeep(folderId: string): Promise<DriveImage[]>;
  downloadThumbnail(image: DriveImage): Promise<Buffer | null>;
  downloadFile(fileId: string): Promise<Buffer>;
  thumbnailFor(fileId: string): Promise<Buffer | null>;
  listPresentations(folderId: string): Promise<DrivePresentation[]>;
  uploadPdf(name: string, bytes: Uint8Array, folderId: string): Promise<{ id: string; url: string }>;
  uploadFile(name: string, bytes: Uint8Array, mimeType: string, folderId: string): Promise<{ id: string; url: string }>;
}

// Drive query strings wrap values in single quotes; escape backslashes and quotes.
export function escapeDriveQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

const FOLDER_MIME = "mimeType='application/vnd.google-apps.folder' and trashed=false";

// Without these, list/get/create only see "My Drive". Shared drives and content
// nested inside shared-with-me folders (e.g. Active Events > event > Photos) stay
// invisible, which is where the real event photos live.
const ALL_DRIVES = { includeItemsFromAllDrives: true, supportsAllDrives: true } as const;

export function makeDriveClient(drive: drive_v3.Drive): DriveClient {
  async function folderQuery(q: string): Promise<DriveFolder[]> {
    const out: DriveFolder[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q,
        fields: "nextPageToken, files(id,name)",
        orderBy: "name",
        pageSize: 200,
        pageToken,
        ...ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        if (f.id) out.push({ id: f.id, name: f.name ?? "(untitled)" });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && out.length < 1000);
    return out;
  }

  async function imagesInFolder(folderId: string): Promise<DriveImage[]> {
    const out: DriveImage[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${escapeDriveQuery(folderId)}' in parents and mimeType contains 'image/' and trashed=false`,
        fields: "nextPageToken, files(id,name,mimeType,thumbnailLink)",
        pageSize: 100,
        pageToken,
        ...ALL_DRIVES,
      });
      for (const f of res.data.files ?? []) {
        if (!f.id) continue;
        out.push({
          id: f.id,
          name: f.name ?? "(untitled)",
          mimeType: f.mimeType ?? "application/octet-stream",
          thumbnailLink: f.thumbnailLink ?? null,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  async function childFolders(parentId: string): Promise<DriveFolder[]> {
    return folderQuery(`'${escapeDriveQuery(parentId)}' in parents and ${FOLDER_MIME}`);
  }

  return {
    async listFolders() {
      const res = await drive.files.list({
        q: FOLDER_MIME,
        fields: "files(id,name)",
        orderBy: "name",
        pageSize: 100,
        ...ALL_DRIVES,
      });
      return (res.data.files ?? [])
        .filter((f): f is typeof f & { id: string } => !!f.id)
        .map((f) => ({ id: f.id, name: f.name ?? "(untitled)" }));
    },
    async listChildFolders(parentId: string) {
      return childFolders(parentId);
    },
    async listSharedFolders() {
      return folderQuery(`sharedWithMe = true and ${FOLDER_MIME}`);
    },
    async searchFolders(term: string) {
      return folderQuery(`name contains '${escapeDriveQuery(term)}' and ${FOLDER_MIME}`);
    },
    async listImages(folderId: string) {
      return imagesInFolder(folderId);
    },
    async listImagesDeep(rootId: string) {
      // Breadth-first walk of the folder tree. `seen` guards against cycles
      // (a folder can have multiple parents, and shortcuts can point back up)
      // and `byId` dedupes images that live under more than one folder.
      const seen = new Set<string>([rootId]);
      const byId = new Map<string, DriveImage>();
      const queue: string[] = [rootId];
      // Bound the crawl so a pathological tree can't spin forever.
      let foldersVisited = 0;
      const MAX_FOLDERS = 2000;
      while (queue.length && foldersVisited < MAX_FOLDERS) {
        const folderId = queue.shift()!;
        foldersVisited++;
        for (const img of await imagesInFolder(folderId)) {
          if (!byId.has(img.id)) byId.set(img.id, img);
        }
        for (const child of await childFolders(folderId)) {
          if (!seen.has(child.id)) {
            seen.add(child.id);
            queue.push(child.id);
          }
        }
      }
      return [...byId.values()];
    },
    async downloadThumbnail(image: DriveImage) {
      if (!image.thumbnailLink) return null;
      try {
        // drive client shares the OAuth2 auth; reuse its request to carry credentials
        const res = await (drive.context._options.auth as any).request({
          url: image.thumbnailLink,
          responseType: "arraybuffer",
        });
        return Buffer.from(res.data as ArrayBuffer);
      } catch {
        return null;
      }
    },
    async downloadFile(fileId: string) {
      const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
      return Buffer.from(res.data as ArrayBuffer);
    },
    async thumbnailFor(fileId: string) {
      const meta = await drive.files.get({ fileId, fields: "thumbnailLink", supportsAllDrives: true });
      const link = meta.data.thumbnailLink;
      if (!link) return null;
      try {
        const res = await (drive.context._options.auth as any).request({
          url: link,
          responseType: "arraybuffer",
        });
        return Buffer.from(res.data as ArrayBuffer);
      } catch {
        return null;
      }
    },
    async listPresentations(folderId: string) {
      const out: DrivePresentation[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and mimeType='application/vnd.openxmlformats-officedocument.presentationml.presentation' and trashed=false`,
          fields: "nextPageToken, files(id,name)",
          pageSize: 100,
          pageToken,
          ...ALL_DRIVES,
        });
        for (const f of res.data.files ?? []) {
          if (f.id) out.push({ id: f.id, name: f.name ?? "(untitled)" });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
    },
    async uploadPdf(name: string, bytes: Uint8Array, folderId: string) {
      const res = await drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : undefined },
        media: { mimeType: "application/pdf", body: Readable.from(Buffer.from(bytes)) },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      const id = res.data.id;
      if (!id) throw new Error("Drive did not return a file id");
      return { id, url: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view` };
    },
    async uploadFile(name: string, bytes: Uint8Array, mimeType: string, folderId: string) {
      const res = await drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : undefined },
        media: { mimeType, body: Readable.from(Buffer.from(bytes)) },
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      const id = res.data.id;
      if (!id) throw new Error("Drive did not return a file id");
      return { id, url: res.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view` };
    },
  };
}
