// Shared browser-side signed-URL upload helper. Extracted byte-for-byte
// (move-only, no behavior change) from components/dashboard/MediaLibraryCard.jsx
// so components/archive/QuickIngestPanel.jsx (Lane 2 phone intake) can reuse
// the exact same XHR PUT mechanic instead of a second implementation.
export function uploadFileToSignedUrl({ file, upload, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method || 'PUT', upload.uploadUrl);
    xhr.setRequestHeader('Content-Type', upload.contentType || file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed before storage accepted the file.'));
    xhr.send(file);
  });
}
