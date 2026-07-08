export type UploadResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

export function uploadWithProgress(
  url: string,
  form: FormData,
  onProgress: (frac: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        json: async () => JSON.parse(xhr.responseText),
      });
    xhr.onerror = () => reject(new Error("Upload failed. Check the connection."));
    xhr.send(form);
  });
}
