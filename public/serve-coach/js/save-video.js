/*
 * save-video.js — saves a recorded clip exactly as MediaRecorder wrote it (no re-encoding).
 * Touch devices with file sharing (iPhone/iPad/Android) get the native share sheet,
 * where iOS offers "Save Video" to Photos. Everything else falls back to <a download>.
 */

/** File extension matching the clip's MIME type. */
export function extensionForMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("webm")) return "webm";
  if (m.includes("matroska") || m.includes("x-mkv")) return "mkv";
  if (m.includes("ogg")) return "ogv";
  return "mp4";
}

const pad = (n) => String(n).padStart(2, "0");

/** serve-coach-YYYYMMDD-HHmmss.<ext>, using local time of the recording. */
export function clipFilename(date, mime) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `serve-coach-${stamp}.${extensionForMime(mime)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Must be called directly from a click handler (no await before it) so iOS keeps user activation.
 * Resolves to 'shared' | 'downloaded' | 'cancelled'. Rejects only when nothing could be saved.
 */
export async function saveVideo(blob, filename) {
  const type = blob.type || "video/mp4";
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (touch && typeof File === "function" && navigator.canShare && navigator.share) {
    const file = new File([blob], filename, { type });
    let can = false;
    try {
      can = navigator.canShare({ files: [file] });
    } catch (e) {
      can = false;
    }
    if (can) {
      try {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelled";
        // NotAllowedError (lost activation / denied) or other: fall through to download.
      }
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}
