/** Upload a blob/File to a signed URL with progress callbacks (XHR). */
export function putWithProgress(
  uploadUrl: string,
  file: Blob,
  contentType: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      let detail = "";
      try {
        const payload = JSON.parse(xhr.responseText || "{}") as {
          message?: unknown;
          error?: unknown;
        };
        detail =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.error === "string"
              ? payload.error
              : "";
      } catch {
        detail = "";
      }
      const safeDetail = detail.replace(/https?:\/\/\S+/g, "").trim();
      reject(
        new Error(
          safeDetail
            ? `Upload rejected (${xhr.status}): ${safeDetail}`
            : `Storage rejected the upload (HTTP ${xhr.status}). Check file size and type.`
        )
      );
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(file);
  });
}
