import * as store from "./store.js";
import { SKELETON_EDGES } from "./overlay.js";
import { defaultOffsetMs } from "./replay.js";
import { servingArm } from "./contact-analysis.js";
import {
  detectServePhases,
  nearestPhasePose,
  comparePhase,
  clearPoint,
  PHASE_VERSION,
} from "./serve-phases.js";

function waitFor(video, event) {
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener("error", bad);
    };
    const ok = () => {
        clean();
        resolve();
      },
      bad = () => {
        clean();
        reject(new Error("Video unavailable"));
      };
    const timer = setTimeout(bad, 8000);
    video.addEventListener(event, ok, { once: true });
    video.addEventListener("error", bad, { once: true });
  });
}
export function initPhaseComparison(host) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../phase-comparison.css", import.meta.url).href;
  document.head.append(link);
  const section = document.createElement("section");
  section.className = "phase-comparison";
  section.setAttribute("aria-labelledby", "phaseHeading");
  section.innerHTML = `<h3 class="sub-h" id="phaseHeading">You and your coach</h3>
    <div class="seg" role="tablist" aria-label="Serve phase">
      <button type="button" role="tab" id="phaseTabToss" aria-controls="phasePanel" data-phase="toss" aria-selected="false" aria-pressed="false" tabindex="-1">Toss</button>
      <button type="button" role="tab" id="phaseTabTrophy" aria-controls="phasePanel" data-phase="trophy" aria-selected="true" aria-pressed="true">Trophy</button>
      <button type="button" role="tab" id="phaseTabFinish" aria-controls="phasePanel" data-phase="finish" aria-selected="false" aria-pressed="false" tabindex="-1">Finish</button>
    </div>
    <div class="block" role="tabpanel" id="phasePanel" aria-labelledby="phaseTabTrophy">
      <p class="empty" id="phaseStatus" role="status" aria-live="polite">Select a saved recording to compare serve positions.</p>
      <div class="phase-pair">
        <figure><figcaption>Your frame</figcaption><canvas class="phase-picture" id="phaseFrame" aria-label="Your extracted recording frame and tracked skeleton" hidden></canvas><p class="empty" id="phaseEmpty">No frame selected.</p></figure>
        <figure><figcaption>Coach reference</figcaption><img class="phase-picture" id="phaseReference" width="360" height="440" alt="Original trophy position illustration"></figure>
      </div>
      <p class="kicker" id="phaseTime"></p>
      <ul class="phase-metrics" id="phaseDifferences"></ul>
      <div class="phase-tools" id="phaseTools" hidden>
        <label for="phaseSeek">Choose a frame · <output id="phaseSeekTime">0.000 s</output></label>
        <input id="phaseSeek" type="range" min="0" max="1" step="0.001" value="0" aria-label="Choose video frame">
        <div class="row"><button class="btn btn-quiet" type="button" id="phasePrev" aria-label="Step back 33 milliseconds">◀ Back</button><button class="btn btn-quiet" type="button" id="phaseNext" aria-label="Step forward 33 milliseconds">Forward ▶</button></div>
        <button class="btn btn-ball" type="button" id="phaseUse">Use this frame for Trophy</button>
        <button class="btn btn-quiet" type="button" id="phaseAuto" hidden>Use automatic frame</button>
      </div>
      <p class="kicker">Original Ace.Tennis illustration, not measured ideal technique. Differences describe this camera view, not ball release, serve accuracy or landing balance.</p>
    </div><video id="phaseVideo" preload="auto" playsinline muted hidden></video>`;
  host.append(section);
  const $ = (id) => section.querySelector("#" + id),
    video = $("phaseVideo"),
    canvas = $("phaseFrame"),
    ctx = canvas.getContext("2d");
  let clip = null,
    frames = [],
    automatic = {},
    phase = "trophy",
    offsetMs = 0,
    url = null,
    loadToken = 0,
    paintToken = 0,
    queue = Promise.resolve(),
    previewMs = 0,
    ready = false;
  const phaseName = () => phase[0].toUpperCase() + phase.slice(1);
  function reference() {
    const arm = servingArm(clip?.dominantHand || clip?.servingArm) || "right";
    $("phaseReference").src = new URL(`../assets/coach-${phase}-${arm}.svg`, import.meta.url).href;
    $("phaseReference").alt =
      `Original ${arm}-handed ${phaseName().toLowerCase()} position illustration`;
    $("phaseUse").textContent = `Use this frame for ${phaseName()}`;
  }
  function clear() {
    loadToken++;
    paintToken++;
    ready = false;
    clip = null;
    frames = [];
    automatic = {};
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
    canvas.hidden = true;
    $("phaseEmpty").hidden = false;
    $("phaseTools").hidden = true;
    $("phaseTime").textContent = "";
    $("phaseDifferences").replaceChildren();
    $("phaseStatus").textContent = "Select a saved recording to compare serve positions.";
  }
  function differences(frame) {
    const result = comparePhase(frame, clip, phase),
      list = $("phaseDifferences");
    list.replaceChildren();
    const add = (text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.append(li);
    };
    if (result.elbow) {
      const e = result.elbow,
        name = phase === "toss" ? "Non-serving elbow" : "Serving elbow";
      add(
        `${name}: your camera-view estimate ${e.observedDegrees.toFixed(0)}°; illustration ${e.referenceDegrees.toFixed(0)}° (${Math.abs(e.differenceDegrees).toFixed(0)}° ${e.differenceDegrees >= 0 ? "more open" : "more bent"} in this view).`,
      );
    }
    if (result.wrist)
      add(
        `${phase === "toss" ? "Non-serving" : "Serving"} wrist: ${result.wrist.observed} the shoulder in your frame; ${result.wrist.reference} in the illustration.`,
      );
    if (!result.elbow && !result.wrist)
      add(
        "Insufficient clear, aligned arm tracking to compare this frame. The selected video image is still available.",
      );
  }
  function showAt(ms, source) {
    const request = ++paintToken,
      generation = loadToken;
    previewMs = ms;
    $("phaseSeek").value = String(ms / 1000);
    $("phaseSeekTime").textContent = (ms / 1000).toFixed(3) + " s";
    $("phaseUse").disabled = true;
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (request !== paintToken || generation !== loadToken || !ready) return;
        try {
          const seconds = ms / 1000;
          if (Math.abs(video.currentTime - seconds) > 0.001) {
            const seek = waitFor(video, "seeked");
            video.currentTime = seconds;
            await seek;
          }
          if (video.readyState < 2) await waitFor(video, "loadeddata");
          if (request !== paintToken || generation !== loadToken) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const aligned = clip.sync?.offsetMs != null;
          const frame = aligned
            ? nearestPhasePose(frames, video.currentTime * 1000, offsetMs)
            : null;
          const theme = getComputedStyle(document.documentElement);
          ctx.strokeStyle = theme.getPropertyValue("--grass").trim();
          ctx.fillStyle = ctx.strokeStyle;
          ctx.lineWidth = Math.max(2, canvas.width / 200);
          ctx.lineCap = "round";
          if (frame) {
            for (const [a, b] of SKELETON_EDGES)
              if (clearPoint(frame, a) && clearPoint(frame, b)) {
                ctx.beginPath();
                ctx.moveTo(frame.kp[a * 3] * canvas.width, frame.kp[a * 3 + 1] * canvas.height);
                ctx.lineTo(frame.kp[b * 3] * canvas.width, frame.kp[b * 3 + 1] * canvas.height);
                ctx.stroke();
              }
            for (let i = 0; i < 17; i++)
              if (clearPoint(frame, i)) {
                ctx.beginPath();
                ctx.arc(
                  frame.kp[i * 3] * canvas.width,
                  frame.kp[i * 3 + 1] * canvas.height,
                  Math.max(3, canvas.width / 140),
                  0,
                  Math.PI * 2,
                );
                ctx.fill();
              }
          }
          canvas.hidden = false;
          $("phaseEmpty").hidden = true;
          $("phaseTime").textContent =
            `${phaseName()} · ${video.currentTime.toFixed(3)} s · ${source}${frame ? " · Skeleton from saved tracking" : ""}`;
          differences(frame);
          $("phaseUse").disabled = false;
        } catch {
          if (request === paintToken && generation === loadToken) {
            $("phaseStatus").textContent =
              "This video frame could not be opened. Try another moment or reopen the recording.";
          }
        }
      });
    return queue;
  }
  async function display() {
    reference();
    $("phaseDifferences").replaceChildren();
    if (!ready) return;
    const manual = clip.phaseSelections?.[phase],
      auto = automatic[phase];
    $("phaseAuto").hidden = !manual || !auto;
    if (
      manual?.version === PHASE_VERSION &&
      Number.isFinite(manual.videoTimestampMs) &&
      manual.videoTimestampMs >= 0 &&
      manual.videoTimestampMs <= clip.video.durationMs
    ) {
      $("phaseStatus").textContent =
        "Your manually selected frame. Phase labels are not automatically verified.";
      await showAt(manual.videoTimestampMs, "Manual selection");
    } else if (auto && clip.sync?.offsetMs != null) {
      $("phaseStatus").textContent =
        phase === "toss"
          ? "Estimated toss position from the raised non-serving arm; ball release is not detected."
          : `Estimated ${phaseName().toLowerCase()} position from one tracked serving sequence.`;
      await showAt(auto.videoTimestampMs, "Automatic estimate");
    } else {
      $("phaseStatus").textContent =
        clip.sync?.offsetMs == null
          ? "Video timing has not been aligned. Select a frame manually; open Replay to align saved tracking."
          : `No reliable ${phaseName().toLowerCase()} position detected. Choose a frame manually.`;
      await showAt(0, "Preview — not a detected phase");
    }
  }
  const tabs = [...section.querySelectorAll("[data-phase]")];
  function selectTab(tab) {
    phase = tab.dataset.phase;
    for (const b of tabs) {
      const active = b === tab;
      b.setAttribute("aria-selected", String(active));
      b.setAttribute("aria-pressed", String(active));
      b.tabIndex = active ? 0 : -1;
    }
    $("phasePanel").setAttribute("aria-labelledby", tab.id);
    display();
  }
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectTab(b));
    b.addEventListener("keydown", (e) => {
      let n = null;
      if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      if (e.key === "ArrowLeft") n = (i + tabs.length - 1) % tabs.length;
      if (e.key === "Home") n = 0;
      if (e.key === "End") n = tabs.length - 1;
      if (n !== null) {
        e.preventDefault();
        const next = tabs[n];
        next.focus();
        selectTab(next);
      }
    });
  });
  const preview = (ms) => {
    if (!ready) return;
    $("phaseStatus").textContent = `Choosing a ${phaseName().toLowerCase()} frame; not saved yet.`;
    showAt(Math.max(0, Math.min(clip.video.durationMs - 1, ms)), "Manual preview");
  };
  $("phaseSeek").addEventListener("input", () => preview(Number($("phaseSeek").value) * 1000));
  $("phasePrev").addEventListener("click", () => preview(previewMs - 1000 / 30));
  $("phaseNext").addEventListener("click", () => preview(previewMs + 1000 / 30));
  $("phaseUse").addEventListener("click", async () => {
    if (!clip || !ready) return;
    const id = clip.id,
      key = phase,
      generation = loadToken,
      ms = previewMs;
    $("phaseUse").disabled = true;
    try {
      const latest = await store.getClip(id);
      if (!latest || latest.deletedAt) throw new Error("missing");
      const selections = {
        ...latest.phaseSelections,
        [key]: {
          version: PHASE_VERSION,
          videoTimestampMs: ms,
          source: "manual",
          savedAt: new Date().toISOString(),
        },
      };
      await store.updateClip(id, { phaseSelections: selections });
      if (generation === loadToken) {
        clip = { ...clip, phaseSelections: selections };
        await display();
      }
    } catch {
      if (generation === loadToken) {
        $("phaseStatus").textContent = "Your frame selection could not be saved. Try again.";
        $("phaseUse").disabled = false;
      }
    }
  });
  $("phaseAuto").addEventListener("click", async () => {
    if (!clip) return;
    const id = clip.id,
      key = phase,
      generation = loadToken;
    try {
      const latest = await store.getClip(id);
      if (!latest || latest.deletedAt) throw new Error("missing");
      const selections = { ...latest.phaseSelections };
      delete selections[key];
      await store.updateClip(id, { phaseSelections: selections });
      if (generation === loadToken) {
        clip = { ...clip, phaseSelections: selections };
        await display();
      }
    } catch {
      if (generation === loadToken)
        $("phaseStatus").textContent = "The automatic frame could not be restored. Try again.";
    }
  });
  async function load(recording) {
    clear();
    clip = recording;
    reference();
    if (recording.restoredWithoutVideo) {
      $("phaseStatus").textContent =
        "Frame comparison needs the original video. This clip was restored from a practice data backup.";
      return;
    }
    const generation = loadToken;
    $("phaseStatus").textContent = "Opening your recording frames…";
    try {
      const [saved, { blob }] = await Promise.all([
        store.getClipPoses(clip.id),
        store.getClipVideo(clip, { playback: true }),
      ]);
      if (generation !== loadToken) return;
      if (!blob.size) throw new Error("empty");
      frames = saved;
      offsetMs = clip.sync?.offsetMs ?? defaultOffsetMs();
      automatic = detectServePhases(frames, clip, offsetMs);
      url = URL.createObjectURL(blob);
      const metadata = waitFor(video, "loadedmetadata");
      video.src = url;
      await metadata;
      if (generation !== loadToken) return;
      const length = Number.isFinite(video.duration)
        ? video.duration * 1000
        : clip.video?.durationMs;
      if (!(length > 0)) throw new Error("duration");
      clip = { ...clip, video: { ...clip.video, durationMs: length } };
      $("phaseSeek").max = String(Math.max(0, (length - 1) / 1000));
      $("phaseTools").hidden = false;
      ready = true;
      await display();
    } catch {
      if (generation === loadToken) {
        $("phaseStatus").textContent = "This recording could not be opened for frame comparison.";
        $("phaseTools").hidden = true;
      }
    }
  }
  window.addEventListener("pagehide", clear);
  window.addEventListener("hashchange", () => {
    if (location.hash !== "#progress") clear();
  });
  reference();
  return { load, clear };
}
