/*
 * replay.js — the Replay screen (MVP1 Stage B).
 *
 * Plays a saved clip with its recorded skeleton drawn on top, in sync. Each video frame is
 * drawn with requestVideoFrameCallback (falls back to requestAnimationFrame) using the
 * frame's own media time, so slow motion, pausing and seeking stay aligned.
 *
 * Sync: browsers start the video file slightly before or after our pose clock (WP0: iPhone
 * ≈0 ms, Android Chrome ≈−350 ms, desktop Chrome ≈−440 ms). On a clip's first replay we
 * measure its own offset: re-run MoveNet on a few replayed frames and find the time shift
 * where the saved keypoints match best. The result is saved on the clip (clip.sync) and used
 * from then on. If it can't be measured, a per-browser default is used.
 *
 * Mirror only flips the picture (video + skeleton), never the controls. Recordings are
 * stored unmirrored.
 */

import * as store from "./store.js";
import { nearestSample } from "./pose-timeline.js";
import { SkeletonOverlay, drawTossTrack } from "./overlay.js";
import { estimateFrame } from "./pose.js";
import { tripodName, orientationName } from "./labels.js";
import { saveVideo, clipFilename } from "./save-video.js";
import { resolveServingArm } from "./contact-analysis.js";

import { buildClipAnalysis } from "./practice-data.js";
import { wristTrailSamples, drawSwingArc } from "./swing-arc.js";
import { replayWristSummary } from "./replay-metrics.js";

import { seekUploadVideo } from "./upload-media.js";

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
const fmtMB = (b) => (b / 1e6 >= 10 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + " MB";
const sideName = (s) => (s === "ad" ? "Ad" : s === "deuce" ? "Deuce" : "–");
const camName = (c) => (c && c.facing === "user" ? "Front" : "Rear");

const SEARCH_MS = 1500,
  STEP_MS = 20,
  SAMPLES = 10;

/** Fallback offsets measured in WP0, by browser. */
export function defaultOffsetMs() {
  const ua = navigator.userAgent;
  const safari = /Safari/.test(ua) && !/Chrome|CriOS|Android/.test(ua);
  if (safari || /iPhone|iPad/.test(ua)) return 0;
  if (/Android/.test(ua)) return -350;
  if (/Chrome/.test(ua)) return -440;
  return 0;
}

function waitFor(el, ev, ms = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(false);
      }
    }, ms);
    el.addEventListener(
      ev,
      () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(true);
        }
      },
      { once: true },
    );
  });
}

export function initReplay({ onDeleted } = {}) {
  const styles = document.createElement("link");
  styles.rel = "stylesheet";
  styles.href = new URL("../replay-analysis.css?v=1.6.6", import.meta.url).href;
  document.head.appendChild(styles);
  const video = $("rpVideo");
  const overlay = new SkeletonOverlay($("rpCanvas"), video);
  let clip = null,
    frames = [],
    url = null,
    offsetMs = 0,
    clipBlob = null;
  let skeletonOn = true,
    mirrorOn = false,
    calibrating = false,
    syncId = 0,
    openToken = 0;
  let wantedId = null,
    selectedArm = null,
    wantedPoseMs = null,
    wantedToss = false,
    realign = false;

  const movement = document.createElement("section");
  movement.className = "block";
  movement.innerHTML = `<h2 class="sec-h">Movement in replay</h2>
    <div class="rp-wrist-reading" aria-live="polite">
      <h3 class="rp-wrist-heading">Estimated wrist speed</h3>
      <p id="rpWrist"></p>
      <p class="rec-label" id="rpWristContext"></p>
    </div>
    <div class="rp-toggles">
      <button class="rp-tog" id="rpAngles" type="button" aria-pressed="false" disabled>2D angles</button>
      <button class="rp-tog" id="rpToss" type="button" aria-pressed="false" hidden>Toss path</button>
      <button class="rp-tog" id="rpTrajectoryTrail" type="button" aria-pressed="false" disabled>Wrist trail</button>
    </div>
    <p class="rec-label" id="rpMeasurements"></p>
    <div class="rp-jumps" role="group" aria-label="Jump to a tracked moment">
      <button class="btn btn-quiet" id="rpSpeedPeak" type="button" disabled>Fastest wrist movement</button>
      <button class="btn btn-quiet" id="rpContact" type="button" disabled>Overhead reach</button>
    </div>
    <p class="rec-label" id="rpReachStatus"></p>
    <button class="btn btn-quiet" id="rpRealign" type="button" hidden>Re-align tracking</button>
    <p class="rec-label" id="rpWristNote"></p>`;
  $("rpInfo").before(movement);
  let analysis = null,
    anglesOn = false,
    trailOn = false,
    tossOn = false;
  const measurement = $("rpMeasurements");
  $("rpBox").append(measurement);
  measurement.classList.add("rp-measurements");

  function paintSpeed() {
    analysis = buildClipAnalysis(clip, frames, { arm: selectedArm, offsetMs });
    const angle = analysis.metrics.contact?.elbowAngleDegrees;
    $("rpReachStatus").textContent = Number.isFinite(angle)
      ? `Estimated overhead reach · ${angle.toFixed(0)}° elbow angle.`
      : "Overhead reach unavailable. The serving arm needs to be visible from preparation through reach.";
    const summary = replayWristSummary(analysis.metrics);
    const bands = {
      "near-average": "Near this clip’s average",
      faster: "Faster than this clip’s average",
      "much-faster": "Much faster than this clip’s average",
    };
    $("rpWrist").textContent = summary.kind === "estimated-speed"
      ? `~${summary.mph.toFixed(1)} mph`
      : "Speed estimate unavailable";
    $("rpWristContext").textContent = summary.kind === "estimated-speed"
      ? "At estimated overhead reach"
      : summary.kind === "relative-motion"
        ? `Peak wrist movement: ${bands[summary.band]}. Tracking does not support an mph estimate.`
        : "Continuous serving-wrist and torso tracking are needed.";
    $("rpWristNote").textContent = summary.kind === "estimated-speed"
      ? "Approximate 2D wrist estimate using an assumed 0.50 m torso. Not measured racket or ball speed; overhead reach is not verified ball contact."
      : summary.kind === "relative-motion"
        ? "Relative movement within this recording only—not physical speed, acceleration or a skill rating."
        : "";
  }
  function jumpTo(poseMs) {
    if (calibrating || !Number.isFinite(poseMs)) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(duration(), (poseMs - offsetMs) / 1000));
    if (!video.seeking) redraw();
  }
  $("rpSpeedPeak").addEventListener("click", () => jumpTo(analysis?.metrics.wrist?.peak.t));
  $("rpContact").addEventListener("click", () =>
    jumpTo(analysis?.metrics.contact?.poseTimestampMs),
  );
  $("rpAngles").addEventListener("click", () => {
    anglesOn = !anglesOn;
    $("rpAngles").setAttribute("aria-pressed", String(anglesOn));
    redraw();
  });
  $("rpTrajectoryTrail").addEventListener("click", () => {
    trailOn = !trailOn;
    $("rpTrajectoryTrail").setAttribute("aria-pressed", String(trailOn));
    redraw();
  });
  const tossButton = $("rpToss");
  function setToss(on) {
    tossOn = on;
    tossButton.setAttribute("aria-pressed", String(on));
  }
  tossButton.addEventListener("click", () => {
    setToss(!tossOn);
    redraw();
  });

  /* ---------- pose lookup and drawing ---------- */
  function poseAt(tMs, maxGap = 250, source = frames) {
    return nearestSample(source, tMs, maxGap);
  }
  function toVideoPx(kp) {
    const vw = video.videoWidth,
      vh = video.videoHeight,
      out = [];
    for (let i = 0; i < 17; i++)
      out.push({ x: kp[i * 3] * vw, y: kp[i * 3 + 1] * vh, score: kp[i * 3 + 2] });
    return out;
  }
  function drawAt(tMs) {
    if (video.seeking) return;
    if (calibrating || !video.videoWidth) {
      overlay.clear();
      return;
    }
    const poseMs = tMs + offsetMs;
    const f = poseAt(poseMs);
    overlay.draw(skeletonOn && f?.kp ? toVideoPx(f.kp) : null);
    const m = anglesOn && poseAt(poseMs, 110, analysis?.frames || []);
    const jointAngles = m?.smoothedJointAngles;
    const values = [
      jointAngles?.leftKnee,
      jointAngles?.rightKnee,
      jointAngles?.leftElbow,
      jointAngles?.rightElbow,
      m?.shoulderTilt,
      m?.bodyLean,
    ];
    const labels = ["L knee", "R knee", "L elbow", "R elbow", "Shoulder tilt", "Body lean"];
    measurement.hidden = !anglesOn;
    const reading = values
      .flatMap((v, i) => (Number.isFinite(v) ? [`${labels[i]} ${v.toFixed(0)}°`] : []))
      .join(" · ");
    const display = reading || "2D angles unavailable here";
    if (anglesOn && measurement.textContent !== display) measurement.textContent = display;
    if (tossOn) drawTossTrack(overlay, clip?.ballToss);
    const wrist = analysis?.metrics.wrist;
    if (trailOn && wrist) {
      drawSwingArc(overlay, wristTrailSamples(wrist.trajectory, poseMs), { poseMs, peak: wrist.peak });
    }
  }
  function startSync() {
    const id = ++syncId;
    if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
      const cb = (now, md) => {
        if (id !== syncId) return;
        drawAt(md.mediaTime * 1000);
        updateTime();
        video.requestVideoFrameCallback(cb);
      };
      video.requestVideoFrameCallback(cb);
    } else {
      const loop = () => {
        if (id !== syncId) return;
        drawAt(video.currentTime * 1000);
        updateTime();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }
  const redraw = () => {
    drawAt(video.currentTime * 1000);
    updateTime();
  };
  video.addEventListener("seeked", redraw);
  video.addEventListener("pause", () => {
    redraw();
    $("rpPlay").textContent = "Play";
  });
  video.addEventListener("play", () => {
    $("rpPlay").textContent = "Pause";
  });
  video.addEventListener("ended", () => {
    $("rpPlay").textContent = "Play";
  });

  /* ---------- time and seek ---------- */
  const duration = () =>
    Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : ((clip && clip.video && clip.video.durationMs) || 0) / 1000;
  let dragging = false;
  function updateTime() {
    const d = duration();
    $("rpTime").textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
    if (!dragging && d) $("rpSeek").value = String(Math.round((video.currentTime / d) * 1000));
  }
  $("rpSeek").addEventListener("input", () => {
    dragging = true;
    const d = duration();
    if (d) video.currentTime = (+$("rpSeek").value / 1000) * d;
  });
  $("rpSeek").addEventListener("change", () => {
    dragging = false;
  });
  $("rpPlay").addEventListener("click", () => {
    if (calibrating) return;
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      video.play().catch(() => {});
    } else video.pause();
  });
  document.querySelectorAll("[data-rpstep]").forEach((b) =>
    b.addEventListener("click", () => {
      video.pause();
      video.currentTime = Math.min(duration(), Math.max(0, video.currentTime + +b.dataset.rpstep));
    }),
  );
  document.querySelectorAll("[data-rprate]").forEach((b) =>
    b.addEventListener("click", () => {
      setRate(+b.dataset.rprate);
      document
        .querySelectorAll("[data-rprate]")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }),
  );
  // Keep the chosen speed across pause, replay-from-end and any media reload (browsers reset to defaultPlaybackRate on load).
  let rate = 1;
  function setRate(r) {
    rate = r;
    video.defaultPlaybackRate = r;
    video.playbackRate = r;
  }
  video.addEventListener("loadeddata", () => {
    if (video.playbackRate !== rate) video.playbackRate = rate;
  });
  video.addEventListener("play", () => {
    if (video.playbackRate !== rate) video.playbackRate = rate;
  });
  $("rpSkel").addEventListener("click", () => {
    skeletonOn = !skeletonOn;
    $("rpSkel").setAttribute("aria-pressed", String(skeletonOn));
    redraw();
  });
  $("rpMirror").addEventListener("click", () => {
    mirrorOn = !mirrorOn;
    $("rpMirror").setAttribute("aria-pressed", String(mirrorOn));
    $("rpBox").classList.toggle("mirror", mirrorOn);
  });

  /* ---------- sync calibration (first replay of a clip) ---------- */
  async function calibrate(token) {
    const good = frames.filter(
      (x) => x.kp && x.kp.filter((v, i) => i % 3 === 2 && v >= 0.4).length >= 10,
    );
    if (good.length < 15)
      return {
        offsetMs: defaultOffsetMs(),
        method: "default",
        reason: "not enough tracked movement",
      };
    const samples = [];
    for (let i = 1; i <= SAMPLES; i++)
      samples.push(good[Math.floor((i * good.length) / (SAMPLES + 1))].t);
    const offsets = [];
    for (let o = -SEARCH_MS; o <= SEARCH_MS; o += STEP_MS) offsets.push(o);
    const err = new Array(offsets.length).fill(0),
      cnt = new Array(offsets.length).fill(0);
    let used = 0;
    for (const [n, t] of samples.entries()) {
      if (token !== openToken) return null;
      $("rpStatus").textContent =
        `Aligning skeleton with the video… ${Math.round((n / samples.length) * 100)}%`;
      try {
        await seekUploadVideo(video, Math.min(t / 1000, Math.max(0, duration() - 0.04)), {
          timeoutMs: 1500,
        });
      } catch {
        continue;
      }
      if (token !== openToken) return null;
      const videoMs = video.currentTime * 1000;
      const p = await estimateFrame(video);
      if (!p) continue;
      used++;
      const vw = video.videoWidth,
        vh = video.videoHeight;
      offsets.forEach((o, j) => {
        const s = poseAt(videoMs + o, 60);
        if (!s || !s.kp) return;
        let e = 0,
          k = 0;
        for (let i = 0; i < 17; i++) {
          if (p.keypoints[i].score < 0.4 || s.kp[i * 3 + 2] < 0.4) continue;
          e += Math.hypot(
            p.keypoints[i].x / vw - s.kp[i * 3],
            p.keypoints[i].y / vh - s.kp[i * 3 + 1],
          );
          k++;
        }
        if (k >= 6) {
          err[j] += e / k;
          cnt[j]++;
        }
      });
    }
    const mean = err.map((e, j) => (cnt[j] >= 3 ? e / cnt[j] : Infinity));
    let best = 0;
    mean.forEach((m, j) => {
      if (m < mean[best]) best = j;
    });
    const zero = offsets.indexOf(0);
    if (!Number.isFinite(mean[best]) || Math.abs(offsets[best]) >= SEARCH_MS) {
      return {
        offsetMs: defaultOffsetMs(),
        method: "default",
        reason: "measurement unclear",
        samples: used,
      };
    }
    return {
      offsetMs: offsets[best],
      method: "measured",
      samples: used,
      errorAtBest: +mean[best].toFixed(4),
      errorAtZero: Number.isFinite(mean[zero]) ? +mean[zero].toFixed(4) : null,
    };
  }

  /* ---------- save / download (original file, no re-encoding) ---------- */
  let saveTimer = null;
  function setSave(state, msg = "", kind = "") {
    const b = $("rpSave");
    if (!b) return;
    clearTimeout(saveTimer);
    b.disabled = state === "idle" || state === "busy";
    b.setAttribute("aria-busy", String(state === "busy"));
    $("rpSaveL").textContent = state === "busy" ? "Preparing video…" : "Save video";
    $("rpSaveMsg").textContent = msg;
    $("rpSaveMsg").dataset.kind = kind;
    if (state === "done" || state === "note")
      saveTimer = setTimeout(() => setSave(clipBlob ? "ready" : "idle"), 5000);
  }
  $("rpSave").addEventListener("click", () => {
    if (!clipBlob || !clip) return;
    const name = clipFilename(
      new Date(clip.createdAt),
      clipBlob.type || (clip.video && clip.video.mime),
    );
    const token = openToken;
    setSave("busy");
    saveVideo(clipBlob, name)
      .then((r) => {
        if (token !== openToken) return;
        if (r === "cancelled") setSave("note", "Not saved. Tap Save video to try again.");
        else if (r === "shared")
          setSave(
            "done",
            "Video handed to the share sheet. Check the destination you selected.",
            "ok",
          );
        else setSave("done", `Downloading ${name}`, "ok");
      })
      .catch(() => {
        if (token === openToken)
          setSave("ready", "Couldn’t save this video. Please try again.", "error");
      });
  });

  /* ---------- open / close ---------- */
  function setControls(on) {
    ["rpPlay", "rpSeek", "rpSkel", "rpMirror", "rpDelete"].forEach((id) => {
      $(id).disabled = !on;
    });
    $("rpRealign").hidden = !on || clip?.source === "upload" || !frames.length;
    $("rpSpeedPeak").disabled = !on || !analysis?.metrics.wrist;
    $("rpContact").disabled = !on || !analysis?.metrics.contact;
    $("rpAngles").disabled = !on;
    $("rpTrajectoryTrail").disabled = !on || !analysis?.metrics.wrist;
    document.querySelectorAll("[data-rprate],[data-rpstep]").forEach((b) => {
      b.disabled = !on;
    });
  }

  function info(c) {
    const dl = $("rpInfo");
    dl.innerHTML = "";
    const sync =
      c.sync && c.sync.offsetMs != null
        ? c.sync.method === "measured"
          ? `Aligned (${c.sync.offsetMs} ms)`
          : `Standard alignment (${c.sync.offsetMs} ms)`
        : "Not aligned yet";
    const rows = [
      [
        "Recorded",
        new Date(c.createdAt).toLocaleString([], {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
      ],
      ["Serving side", sideName(c.side)],
      ["Tripod position", tripodName(c.tripodPosition)],
      ["Phone camera", camName(c.camera)],
      ["Orientation", orientationName(c.video && c.video.orientation)],
      ["Length", fmtTime(Math.round(((c.video && c.video.durationMs) || 0) / 1000))],
      [
        "Size",
        fmtMB((c.video && c.video.bytes) || 0) +
          ` · ${(c.video && c.video.width) || "?"}×${(c.video && c.video.height) || "?"}`,
      ],
      [
        "Movement",
        `${(c.poses && c.poses.frames) || frames.length} frames${c.poses && c.poses.fps ? ` · ${c.poses.fps} per second` : ""}`,
      ],
      ["Skeleton sync", sync],
    ];
    if (c.status && c.status.startsWith("interrupted"))
      rows.push(["Note", "Interrupted: " + (c.stopReason || "saved up to the interruption")]);
    rows.forEach(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      dl.append(dt, dd);
    });
  }

  function release() {
    syncId++;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
    overlay.clear();
    clipBlob = null;
    setSave("idle");
    analysis = null;
    trailOn = false;
    $("rpTrajectoryTrail").setAttribute("aria-pressed", "false");
    tossButton.hidden = true;
    setToss(false);
    selectedArm = null;
    measurement.hidden = true;
    $("rpWrist").textContent = "";
    $("rpWristContext").textContent = "";
    $("rpWristNote").textContent = "";
  }

  $("rpRealign").addEventListener("click", () => {
    wantedPoseMs = video.currentTime * 1000 + offsetMs;
    realign = true;
    enter();
  });
  async function enter() {
    const forceRealign = realign;
    realign = false;
    const token = ++openToken;
    release();
    calibrating = false;
    setControls(false);
    $("rpStatus").textContent = "Loading clip…";
    $("rpStatus").dataset.kind = "";
    clip = wantedId ? await store.getClip(wantedId) : null;
    if (token !== openToken) return;
    if (!clip) {
      location.hash = "#progress";
      return;
    }
    const session = await store.getSession(clip.sessionId);
    if (token !== openToken) return;
    selectedArm = resolveServingArm(clip, session, store.prefs.get(store.KEYS.profile));
    $("rpTitle").textContent =
      clip.source === "upload"
        ? `Uploaded video${clip.fileName ? " · " + clip.fileName : ""}`
        : `Clip ${clip.seq} · ${sideName(clip.side)} · Tripod ${tripodName(clip.tripodPosition)}`;
    const [{ blob }, f] = await Promise.all([
      store.getClipVideo(clip),
      store.getClipPoses(clip.id),
    ]);
    if (token !== openToken) return;
    frames = f;
    offsetMs = clip.sync && clip.sync.offsetMs != null ? clip.sync.offsetMs : defaultOffsetMs();
    info(clip);
    if (!blob.size) {
      $("rpStatus").textContent =
        "No video was saved for this clip (it was interrupted before any video was written).";
      $("rpDelete").disabled = false;
      return;
    }
    clipBlob = blob;
    setSave("ready");
    const playbackMime = clip.video?.playbackMime;
    url = URL.createObjectURL(
      typeof playbackMime === "string" && playbackMime !== blob.type
        ? blob.slice(0, blob.size, playbackMime)
        : blob,
    );
    video.src = url;
    setRate(1);
    document
      .querySelectorAll("[data-rprate]")
      .forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.rprate === "1")));
    // Mirror defaults to how the player saw themselves while recording (front camera).
    mirrorOn = !!(clip.camera && clip.camera.facing === "user");
    $("rpMirror").setAttribute("aria-pressed", String(mirrorOn));
    $("rpBox").classList.toggle("mirror", mirrorOn);
    const ok = await waitFor(video, "loadedmetadata", 8000);
    if (token !== openToken) return;
    if (!ok) {
      $("rpStatus").textContent = "This video couldn’t be opened on this browser.";
      $("rpStatus").dataset.kind = "error";
      $("rpDelete").disabled = false;
      return;
    }

    offsetMs = clip.sync && clip.sync.offsetMs != null ? clip.sync.offsetMs : defaultOffsetMs();
    if (!frames.length) {
      $("rpStatus").textContent = clip.uploadAnalysisIncomplete
        ? "Video saved. This phone couldn’t analyse the movement."
        : "No movement data was saved for this clip, so there is no skeleton.";
    } else if (forceRealign || !clip.sync || clip.sync.offsetMs == null) {
      calibrating = true;
      overlay.clear();
      let result = null;
      try {
        result = await calibrate(token);
      } catch (e) {
        result = null;
      }
      if (token !== openToken) return;
      calibrating = false;
      if (
        result &&
        (!forceRealign || result.method === "measured" || clip.sync?.method !== "measured")
      ) {
        offsetMs = result.offsetMs;
        const sync = { ...result, measuredAt: new Date().toISOString() };
        await store.updateClip(clip.id, { sync });
        clip = { ...clip, sync };
        info(clip);
        $("rpStatus").textContent =
          result.method === "measured"
            ? "Skeleton aligned with the video."
            : "Skeleton shown with standard alignment.";
      } else {
        $("rpStatus").textContent = forceRealign
          ? "Couldn’t improve alignment. Previous timing kept."
          : "Skeleton shown with standard alignment (body tracking unavailable to fine-tune it).";
      }
      video.currentTime = 0;
      await waitFor(video, "seeked", 3000);
    } else {
      $("rpStatus").textContent = clip.uploadAnalysisIncomplete
        ? "Video saved. Tracking covers only the frames the phone could analyse."
        : "";
    }
    if (token !== openToken) return;
    paintSpeed();
    tossButton.hidden = !clip.ballToss?.track?.length;
    setToss(wantedToss && !tossButton.hidden);
    wantedToss = false;
    setControls(true);
    startSync();
    redraw();
    if (Number.isFinite(wantedPoseMs)) {
      jumpTo(wantedPoseMs);
      wantedPoseMs = null;
    }
    // Persist the same contact-local estimates shown here after pose/video alignment.
    // Legacy preference fallback remains marked in the analysis, not rewritten into capture data.
    store.finalizeClipData(clip.id, { arm: selectedArm, offsetMs }).catch(() => {
      if (token === openToken)
        $("rpStatus").textContent =
          "Video is saved, but extra measurements couldn’t be saved. Reopen this clip to retry.";
    });
  }

  function leave() {
    openToken++;
    calibrating = false;
    release();
  }

  /* ---------- delete (two taps, no browser popup) ---------- */
  let armTimer = null;
  $("rpDelete").addEventListener("click", async () => {
    const b = $("rpDelete");
    if (!b.classList.contains("armed")) {
      b.classList.add("armed");
      b.textContent = "Tap again to delete this clip";
      armTimer = setTimeout(() => {
        b.classList.remove("armed");
        b.textContent = "Delete clip";
      }, 4000);
      return;
    }
    clearTimeout(armTimer);
    b.classList.remove("armed");
    b.textContent = "Delete clip";
    if (!clip) return;
    const gone = clip;
    leave();
    await store.deleteClip(gone);
    if (onDeleted) onDeleted(gone);
    location.hash = document.querySelector(".rp-back").getAttribute("href") || "#progress";
  });

  return {
    open(clipId, from = "progress", { poseMs = null, toss = false } = {}) {
      wantedId = clipId;
      wantedPoseMs = poseMs;
      wantedToss = toss;
      const back = document.querySelector(".rp-back");
      back.href = "#" + from;
      back.textContent = from === "record" ? "‹ Back to recording" : "‹ Video recordings";
      if (location.hash === "#replay") enter();
      else location.hash = "#replay";
    },
    openMoment(clipId, poseTimestampMs, toss = false) {
      this.open(clipId, "progress", { poseMs: poseTimestampMs, toss });
    },
    hasClip: () => !!wantedId,
    enter,
    leave,
  };
}
