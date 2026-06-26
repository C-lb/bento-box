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
export interface DriveClient {
  listFolders(): Promise<DriveFolder[]>;
  listImages(folderId: string): Promise<DriveImage[]>;
  downloadThumbnail(image: DriveImage): Promise<Buffer | null>;
}

export function makeDriveClient(drive: drive_v3.Drive): DriveClient {
  return {
    async listFolders() {
      const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: "files(id,name)",
        orderBy: "name",
        pageSize: 100,
      });
      return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name ?? "(untitled)" }));
    },
    async listImages(folderId: string) {
      const out: DriveImage[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
          fields: "nextPageToken, files(id,name,mimeType,thumbnailLink)",
          pageSize: 100,
          pageToken,
        });
        for (const f of res.data.files ?? []) {
          out.push({
            id: f.id!,
            name: f.name ?? "(untitled)",
            mimeType: f.mimeType ?? "application/octet-stream",
            thumbnailLink: f.thumbnailLink ?? null,
          });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return out;
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
  };
}
