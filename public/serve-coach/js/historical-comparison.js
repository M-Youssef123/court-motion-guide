import * as store from "./store.js";
import { resolveServingArm } from "./contact-analysis.js";
import { buildClipAnalysis } from "./practice-data.js";
import { detectServePhases, nearestPhasePose } from "./serve-phases.js";
import { SkeletonOverlay } from "./overlay.js";

export function initHistoricalComparison(host) {
  const panel = document.createElement("details");
  panel.className = "block historical";
  panel.innerHTML = `<summary class="sec-h">Compare saved serves</summary>
    <p role="status" data-status></p>
    <label>Playback <select class="input" data-mode><option value="independent">Independent</option><option value="start">Sync from start</option><option value="trophy">Align at estimated Trophy</option><option value="contact">Align at estimated overhead reach</option></select></label>
    <div class="historical-controls" hidden><button class="btn btn-quiet" type="button" data-play>Play both</button>
    <input type="range" min="0" max="0" step="0.01" aria-label="Scrub both clips">
    <label>Speed <select class="input" data-rate><option value="1">1×</option><option value="0.5">0.5×</option><option value="0.25">0.25×</option></select></label></div>
    <div class="historical-pair">${["A", "B"]
      .map(
        (label) => `<section><label>Clip ${label}<select class="input" data-clip></select></label>
      <div class="historical-player"><video playsinline muted preload="metadata"></video><canvas aria-hidden="true"></canvas></div>
      <div class="historical-controls" data-solo hidden><button class="btn btn-quiet" type="button" data-solo-play>Play</button>
      <input type="range" min="0" max="0" step="0.01" aria-label="Scrub clip ${label}">
      <label>Speed <select class="input" data-solo-rate><option value="1">1×</option><option value="0.5">0.5×</option><option value="0.25">0.25×</option></select></label></div>
      <p class="kicker" data-issue role="status"></p></section>`,
      )
      .join("")}</div>
    <div data-metrics></div><p class="kicker">Compare clips filmed from the same position and distance. Angles and speeds describe the camera image.</p>`;
  host.before(panel);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../historical-comparison.css", import.meta.url).href;
  document.head.append(link);
  const q = (selector) => panel.querySelector(selector);
  const status = q("[data-status]"),
    mode = q("[data-mode]"),
    play = q("[data-play]");
  const controls = play.parentElement,
    seek = controls.querySelector("input"),
    rate = q("[data-rate]");
  const sides = [...panel.querySelectorAll(".historical-pair section")].map((el) => {
    const video = el.querySelector("video");
    const solo = el.querySelector("[data-solo]");
    return {
      video,
      solo,
      soloPlay: solo.querySelector("button"),
      soloSeek: solo.querySelector("input"),
      soloRate: solo.querySelector("select"),
      overlay: new SkeletonOverlay(el.querySelector("canvas"), video),
      select: el.querySelector("[data-clip]"),
      issue: el.querySelector("[data-issue]"),
    };
  });
  let request = 0,
    anchors = null,
    start = 0,
    end = 0,
    playing = false,
    playback = 0;
  function stop() {
    playback++;
    playing = false;
    play.textContent = "Play both";
    for (const { video } of sides) if (!video.paused) video.pause();
  }
  function clear() {
    request++;
    stop();
    anchors = null;
    controls.hidden = true;
    for (const side of sides) {
      if (side.url) {
        side.video.removeAttribute("src");
        side.video.load();
        URL.revokeObjectURL(side.url);
      }
      Object.assign(side, { url: null, ready: false, frames: null, summary: null, moments: null });
      side.overlay.clear();
      side.solo.hidden = true;
      side.issue.textContent = "";
    }
    q("[data-metrics]").replaceChildren();
  }
  function draw(side, mediaTime = side.video.currentTime) {
    const video = side.video;
    if (!side.ready) return;
    const frame = Number.isFinite(side.offset)
      ? nearestPhasePose(side.frames, mediaTime * 1000, side.offset)
      : null;
    const points = frame?.kp
      ? Array.from({ length: 17 }, (_, i) => ({
          x: frame.kp[i * 3] * video.videoWidth,
          y: frame.kp[i * 3 + 1] * video.videoHeight,
          score: frame.kp[i * 3 + 2],
        }))
      : null;
    side.overlay.draw(points, 0.6);
    side.soloSeek.value = video.currentTime;
  }
  function setTime(time) {
    if (!anchors) return;
    for (const [i, side] of sides.entries()) side.video.currentTime = anchors[i] + time;
    seek.value = time;
  }
  function sync() {
    stop();
    anchors = null;
    controls.hidden = true;
    const independent = mode.value === "independent";
    for (const side of sides) side.solo.hidden = !independent || !side.ready;
    status.textContent = "";
    if (independent) return;
    if (sides.some((side) => !side.ready)) {
      status.textContent = "Synchronized playback requires two playable videos.";
      return;
    }
    const points = sides.map((side) => (mode.value === "start" ? 0 : side.moments?.[mode.value]));
    if (
      points.some((point, i) => !Number.isFinite(point) || point < 0 || point >= sides[i].duration)
    ) {
      status.textContent =
        "This phase needs reliable, aligned tracking in both clips. Try Sync from start or Independent.";
      return;
    }
    anchors = points;
    start = -Math.min(...anchors);
    end = Math.min(...sides.map((side, i) => side.duration - anchors[i]));
    seek.min = start;
    seek.max = end;
    controls.hidden = false;
    setTime(0);
  }
  function showMetrics() {
    if (!sides.some((side) => side.summary)) return;
    const rows = [
      ["Max overhead elbow extension", "extension", "°"],
      ["Tracked peak wrist speed", "wrist", "% image diagonal/s"],
      ["Observed Trophy hold", "hold", " s"],
    ];
    const table = document.createElement("table");
    table.innerHTML =
      '<thead><tr><th scope="col">Measurement</th><th scope="col">A</th><th scope="col">B</th><th scope="col">B − A</th></tr></thead>';
    const body = table.createTBody();
    for (const [label, key, unit] of rows) {
      const [a, b] = sides.map((side) => side.summary?.[key]);
      const row = body.insertRow(),
        heading = document.createElement("th");
      heading.scope = "row";
      heading.textContent = label;
      row.append(heading);
      for (const value of [a, b, Number.isFinite(a) && Number.isFinite(b) ? b - a : null]) {
        row.insertCell().textContent = Number.isFinite(value)
          ? `${value.toFixed(key === "hold" ? 2 : 1)}${unit}`
          : "—";
      }
    }
    q("[data-metrics]").append(table);
  }
  let entries = [];
  async function load() {
    clear();
    const generation = request;
    status.textContent = "Opening saved clips…";
    const ids = sides.map((side) => side.select.value);
    if (!ids.every(Boolean) || ids[0] === ids[1]) {
      status.textContent = "Choose two different saved clips.";
      return;
    }
    await Promise.all(
      sides.map(async (side, i) => {
        const { clip, session } = entries.find((item) => item.clip.id === ids[i]);
        try {
          const [frames, saved, media] = await Promise.all([
            store.getClipPoses(clip.id),
            store.getClipAnalysis(clip.id),
            clip.restoredWithoutVideo ? null : store.getClipVideo(clip),
          ]);
          if (generation !== request) return;
          const arm = resolveServingArm(clip, session, null);
          const phaseClip = { ...clip, dominantHand: arm, servingArm: arm };
          side.offset = clip.sync?.offsetMs;
          side.duration = clip.video?.durationMs / 1000;
          const analysis = frames.length ? buildClipAnalysis(phaseClip, frames, { arm }) : saved;
          const trophy = detectServePhases(frames, phaseClip).trophy;
          if (analysis)
            side.summary = {
              extension: analysis.metrics?.serve?.maxOverheadElbowDegrees ?? null,
              wrist: analysis.metrics?.wrist?.peak?.speed ?? null,
              hold: analysis.metrics?.serve?.trophyHoldSeconds ?? null,
            };
          side.frames = frames;
          side.moments = Number.isFinite(side.offset)
            ? {
                trophy: trophy?.videoTimestampMs / 1000,
                contact: analysis?.metrics?.contact?.timestampMs / 1000,
              }
            : null;
          if (!media?.blob.size) {
            side.issue.textContent = clip.restoredWithoutVideo
              ? "Backup restored without video. Saved measurements may still be available."
              : "This clip has no saved video.";
            return;
          }
          side.url = URL.createObjectURL(media.blob);
          side.video.src = side.url;
          side.issue.textContent = Number.isFinite(side.offset)
            ? ""
            : "Open this clip in Replay to align its saved skeleton.";
        } catch {
          if (generation === request) side.issue.textContent = "Couldn’t open this clip.";
        }
      }),
    );
    if (generation === request) {
      status.textContent = "";
      showMetrics();
      sync();
    }
  }
  for (const side of sides) {
    const { video } = side;
    side.select.addEventListener("change", load);
    video.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(video.duration) && video.duration > 0) side.duration = video.duration;
      side.ready = Boolean(side.url) && Number.isFinite(side.duration) && side.duration > 0;
      if (side.ready) {
        side.soloSeek.max = side.duration;
        video.playbackRate = Number(side.soloRate.value);
      } else if (side.url) side.issue.textContent = "This video has no playable duration.";
      sync();
    });
    video.addEventListener("error", () => {
      if (!side.url) return;
      side.ready = false;
      side.issue.textContent = "This video could not be played.";
      sync();
    });
    for (const event of ["loadeddata", "seeked", "timeupdate"])
      video.addEventListener(event, () => draw(side));
    let drawGeneration = 0;
    video.addEventListener("play", () => {
      side.soloPlay.textContent = "Pause";
      const current = ++drawGeneration;
      const schedule = video.requestVideoFrameCallback
        ? (frame) => video.requestVideoFrameCallback(frame)
        : (frame) => requestAnimationFrame(frame);
      const frame = (_now, metadata) => {
        if (current !== drawGeneration || !side.ready || video.paused || video.ended) return;
        draw(side, metadata?.mediaTime);
        schedule(frame);
      };
      schedule(frame);
    });
    for (const event of ["pause", "ended"])
      video.addEventListener(event, () => {
        drawGeneration++;
        side.soloPlay.textContent = "Play";
      });
    side.soloPlay.addEventListener("click", () => {
      if (!video.paused) video.pause();
      else
        video.play().catch(() => {
          side.issue.textContent = "Playback could not start.";
        });
    });
    side.soloSeek.addEventListener("input", () => {
      video.currentTime = Number(side.soloSeek.value);
    });
    side.soloRate.addEventListener("change", () => {
      video.playbackRate = Number(side.soloRate.value);
    });
  }
  window.addEventListener("resize", () => sides.forEach(draw));
  mode.addEventListener("change", () => {
    sync();
    if (!anchors) for (const side of sides) side.video.playbackRate = Number(side.soloRate.value);
  });
  seek.addEventListener("input", () => {
    stop();
    setTime(Number(seek.value));
  });
  rate.addEventListener("change", () =>
    sides.forEach(({ video }) => {
      video.playbackRate = Number(rate.value);
    }),
  );
  play.addEventListener("click", () => {
    if (playing) {
      stop();
      return;
    }
    if (!anchors) return;
    if (Number(seek.value) >= end - 0.02) setTime(start);
    playing = true;
    const generation = ++playback;
    play.textContent = "Pause both";
    Promise.all(
      sides.map(({ video }) => {
        video.playbackRate = Number(rate.value);
        return video.play();
      }),
    ).catch(() => {
      if (generation === playback) {
        stop();
        status.textContent = "Playback could not start.";
      }
    });
    const tick = () => {
      if (!playing || generation !== playback) return;
      const time = sides[0].video.currentTime - anchors[0];
      if (time >= end - 0.015 || sides.some((side) => side.video.ended)) {
        stop();
        setTime(end);
        return;
      }
      const follower = sides[1].video;
      if (Math.abs(follower.currentTime - anchors[1] - time) > 0.12 && !follower.seeking)
        follower.currentTime = anchors[1] + time;
      seek.value = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  async function render() {
    clear();
    if (!panel.open) return;
    const generation = request;
    status.textContent = "Loading saved clips…";
    try {
      const sessions = await store.listSessions();
      if (generation !== request) return;
      entries = sessions
        .flatMap((session) =>
          session.clips
            .filter((clip) => !["recording", "interrupted-empty"].includes(clip.status))
            .map((clip) => ({ session, clip })),
        )
        .sort((a, b) => String(a.clip.createdAt).localeCompare(String(b.clip.createdAt)));
      sides.forEach(({ select }, i) => {
        const selected = select.value;
        select.replaceChildren(
          ...entries.map(
            ({ clip }) =>
              new Option(
                `${new Date(clip.createdAt).toLocaleString()} · Clip ${clip.seq}`,
                clip.id,
              ),
          ),
        );
        select.disabled = entries.length < 2;
        select.value = entries.some((item) => item.clip.id === selected)
          ? selected
          : entries[i === 0 ? 0 : entries.length - 1]?.clip.id || "";
      });
      if (entries.length < 2) status.textContent = "Save two clips to compare them here.";
      else await load();
    } catch {
      if (generation === request) status.textContent = "Couldn’t list saved clips.";
    }
  }
  panel.addEventListener("toggle", render);
  window.addEventListener("pagehide", clear);
  return { render, clear };
}
