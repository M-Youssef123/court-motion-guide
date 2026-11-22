/*
 * upload.js — analyse existing footage picked from the device. Everything stays on-device:
 * the original file is stored untouched (no re-encode) and MoveNet runs frame by frame on a
 * inline <video> using the same pose model and saved frame format as live recordings.
 * Pose times are video times, so the clip's sync offset is 0.
 */
import * as store from "./store.js";
import { estimateFrame } from "./pose.js";
import { resolveServingArm } from "./contact-analysis.js";
import { openUploadVideo, seekUploadVideo } from "./upload-media.js";

export const MAX_UPLOAD_MB = 500;
export const MAX_UPLOAD_SECONDS = 120;
export const SAMPLE_FPS = 15;
const VIDEO_TYPES = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  "3gp": "video/3gpp",
};
const MAX_MODEL_EDGE = 640;
export function uploadMime(file) {
  if (file.type?.startsWith("video/")) return file.type;
  if (file.type && file.type !== "application/octet-stream") return "";
  const extension = (file.name || "").match(/\.([^.]+)$/)?.[1].toLowerCase();
  return Object.prototype.hasOwnProperty.call(VIDEO_TYPES, extension) ? VIDEO_TYPES[extension] : "";
}

const CHUNK = 4 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

/** Why a picked file can't be used (or null). Pure; exported for tests. */
export function uploadProblem(file) {
  if (!file) return "No video was chosen.";
  if (!uploadMime(file)) return "That file isn’t a video. Choose a video from your device.";
  if (file.size === 0) return "That video file is empty.";
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024)
    return `That video is too large (over ${MAX_UPLOAD_MB} MB). Trim it to just your serves and try again.`;
  return null;
}

export function initUpload({ openClip }) {
  const input = $("upInput"),
    box = $("upBox"),
    bar = $("upBar"),
    msg = $("upMsg"),
    btn = $("upBtn"),
    cancel = $("upCancel");
  let busy = false,
    aborted = false,
    controller = null;

  const show = (text, kind = "") => {
    msg.textContent = text;
    msg.dataset.kind = kind;
    msg.hidden = !text;
  };
  const progress = (p, text) => {
    box.hidden = false;
    const label = $("upPct");
    if (label.textContent !== text) {
      bar.style.width = Math.round(p * 100) + "%";
      label.textContent = text;
    }
  };
  const done = () => {
    busy = false;
    box.hidden = true;
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    input.value = "";
  };

  btn.addEventListener("click", () => {
    if (!busy) input.click();
  });
  cancel.addEventListener("click", () => {
    aborted = true;
    controller?.abort();
  });
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (f && !busy) run(f);
  });

  async function run(file) {
    const problem = uploadProblem(file);
    if (problem) {
      show(problem, "error");
      input.value = "";
      return;
    }
    busy = true;
    aborted = false;
    controller = new AbortController();
    show("");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    progress(0, "Opening video…");
    const mime = uploadMime(file);
    const url = URL.createObjectURL(file.type === mime ? file : file.slice(0, file.size, mime));
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.setAttribute("aria-label", "Video being processed");
    // Keep a real inline picture rather than a transparent/offscreen decoder surface.
    v.style.cssText =
      "display:block;width:100%;height:180px;object-fit:contain;pointer-events:none;margin-block:8px";
    box.appendChild(v);
    let session = null,
      clip = null;
    const canvas = document.createElement("canvas");
    try {
      await openUploadVideo(v, url, { signal: controller.signal });
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) throw new Error("This video has no readable length.");
      if (dur > MAX_UPLOAD_SECONDS)
        throw new Error(
          `That video is ${Math.round(dur)} s long. Trim it to ${MAX_UPLOAD_SECONDS} s or less and try again.`,
        );
      const st = await store.storageStatus();
      if (st.freeMB !== null && st.freeMB < file.size / 1048576 + 50)
        throw new Error("Not enough free storage on this phone to keep this video.");

      progress(0, "Loading body tracking…");
      const W = v.videoWidth,
        H = v.videoHeight;
      const scale = Math.min(1, MAX_MODEL_EDGE / Math.max(W, H));
      canvas.width = Math.max(1, Math.round(W * scale));
      canvas.height = Math.max(1, Math.round(H * scale));
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Couldn’t prepare a video frame on this device.");
      const frames = [];
      const n = Math.max(1, Math.ceil(dur * SAMPLE_FPS));
      let tracked = 0;
      for (let i = 0; i < n; i++) {
        if (aborted) throw new Error("cancelled");
        const t = i / SAMPLE_FPS;
        await seekUploadVideo(v, t, { signal: controller.signal });
        let p = null;
        try {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          p = await estimateFrame(canvas);
        } catch (e) {
          if (i === 0) throw new Error("Body tracking couldn’t start on this device.");
        }
        const kp =
          p && p.keypoints
            ? p.keypoints.flatMap((k) => [
                +(k.x / canvas.width).toFixed(4),
                +(k.y / canvas.height).toFixed(4),
                +(k.score || 0).toFixed(3),
              ])
            : null;
        if (p?.keypoints.filter((k) => k.score >= 0.35).length >= 5) tracked++;
        frames.push({ t: Math.round(t * 1000), kp });
        progress((i + 1) / n, `Analysing movement… ${Math.round(((i + 1) / n) * 100)}%`);
      }
      if (aborted) throw new Error("cancelled");
      progress(1, "Saving…");
      const profile = store.prefs.get(store.KEYS.profile);
      session = await store.createSession(null, {
        source: "upload",
        playerHand: profile?.hand || null,
      });
      clip = await store.createClip(session.id, {
        source: "upload",
        fileName: file.name || "",
        status: "recording",
        servingArm: resolveServingArm(null, session, profile),
        side: null,
        tripodPosition: "unknown",
        camera: { facing: "environment", label: "Uploaded video" },
        video: {
          mime,
          width: W,
          height: H,
          orientation: H > W ? "portrait" : "landscape",
          bytes: file.size,
          chunks: 0,
          durationMs: Math.round(dur * 1000),
          durationSource: "video-metadata",
        },
        poses: {
          frames: frames.length,
          format:
            "frames: t = ms of video time; kp = 17 x [x/width, y/height, score] in MoveNet order, or null when no pose",
          model: "MoveNet SinglePose Lightning (pose-detection 2.1.3)",
          inputMode: "upload",
          fps: SAMPLE_FPS,
        },
        sync: { offsetMs: 0, method: "upload", measuredAt: new Date().toISOString() },
      });
      let seq = 0;
      for (let o = 0; o < file.size; o += CHUNK) {
        if (aborted) throw new Error("cancelled");
        await store.putChunk(clip.id, seq++, file.slice(o, o + CHUNK, mime));
      }
      await store.putPoses(clip.id, 0, frames);
      if (aborted) throw new Error("cancelled");
      await store.updateClip(clip.id, {
        status: "saved",
        endedAt: new Date().toISOString(),
        video: { ...clip.video, chunks: seq },
      });
      await store.endSession(session.id);
      let analysisWarning = "";
      try {
        await store.finalizeClipData(clip.id);
      } catch (e) {
        analysisWarning =
          "Video and movement saved, but extra measurements couldn’t be saved. Reopen the app to retry.";
      }
      done();
      show(
        analysisWarning ||
          (tracked
            ? ""
            : "Video saved, but no body was found in it, so there’s no skeleton or analysis."),
        analysisWarning || !tracked ? "warn" : "",
      );
      openClip(clip.id);
    } catch (e) {
      if (session) {
        try {
          if (clip) await store.deleteClip(clip);
          await store.deleteSession(session.id);
        } catch (x) {
          /* ignore */
        }
      }
      done();
      if (e && e.message === "cancelled") show("Upload cancelled.");
      else if (e && e.name === "QuotaExceededError")
        show("Not enough free storage on this phone to keep this video.", "error");
      else
        show(
          (e && e.message) || "Something went wrong processing this video. Please try again.",
          "error",
        );
    } finally {
      canvas.width = canvas.height = 1;
      v.removeAttribute("src");
      v.load();
      v.remove();
      URL.revokeObjectURL(url);
      controller = null;
    }
  }
}
