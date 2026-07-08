export type UploadResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function xhrUpload(
  url: string,
  body: FormData | File,
  headers: Record<string, string>,
  onProgress: (frac: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
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
    xhr.send(body);
  });
}

export function uploadWithProgress(
  url: string,
  form: FormData,
  onProgress: (frac: number) => void,
): Promise<UploadResponse> {
  return xhrUpload(url, form, {}, onProgress);
}

/** For endpoints that read a raw streamed body (not multipart), e.g. transcribe
 *  and slice, which key the filename off an `x-filename` header. */
export function uploadRawWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (frac: number) => void,
): Promise<UploadResponse> {
  return xhrUpload(url, file, headers, onProgress);
}
