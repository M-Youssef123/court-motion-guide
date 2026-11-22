import * as store from "./store.js";
import { BALL_TOSS_VERSION, scanBallToss } from "./ball-toss.js";
import { tripodName } from "./labels.js";

export function initTossProgress(host, openMoment) {
  const section = document.createElement("section");
  section.className = "block";
  section.innerHTML = `<h3 class="sub-h">Toss consistency</h3>
    <p class="kicker">Scans the selected recording on this device. Shows toss height and horizontal drift in the camera image.</p>
    <button type="button" class="btn btn-quiet">Scan toss</button>
    <p role="status"></p><p data-history class="kicker"></p>
    <video playsinline muted preload="auto" hidden></video>`;
  host.append(section);
  const button = section.querySelector("button"),
    status = section.querySelector('[role="status"]');
  const video = section.querySelector("video"),
    history = section.querySelector("[data-history]");
  let clip,
    controller,
    generation = 0;
  const matching = (other, selected) =>
    !["unknown", undefined, null].includes(selected.tripodPosition) &&
    other.tripodPosition === selected.tripodPosition &&
    other.source === selected.source &&
    other.camera?.facing === selected.camera?.facing &&
    other.video?.orientation === selected.video?.orientation;
  function render(result) {
    status.replaceChildren();
    if (!result) {
      status.textContent = "Insufficient ball visibility or aligned toss-hand tracking.";
      return;
    }
    const drift = Math.abs(result.driftFromHeadPct).toFixed(1);
    const direction = result.driftFromHeadPct < 0 ? "left" : "right";
    status.append(
      `Toss apex: ${result.heightAboveHeadPct.toFixed(1)}% of frame height above the head. Drift from setup head position: ${drift}% of frame width toward screen ${direction}. Racket impact and depth are unverified. `,
    );
    if (!clip.restoredWithoutVideo && Number.isFinite(clip.sync?.offsetMs)) {
      const links = [["View estimated toss apex", result.apexVideoMs]];
      if (Number.isFinite(result.possibleContactVideoMs)) {
        status.append(" A visible ball change near overhead reach may be worth reviewing. ");
        links.push(["Review possible contact", result.possibleContactVideoMs]);
      }
      for (const [label, videoMs] of links) {
        const link = document.createElement("button");
        link.type = "button";
        link.className = "btn btn-quiet";
        link.textContent = label;
        const id = clip.id,
          ms = videoMs + clip.sync.offsetMs;
        link.addEventListener("click", () => openMoment(id, ms, true));
        status.append(link);
      }
    }
  }
  async function showHistory(selected, request) {
    try {
      const all = (await store.listSessions())
        .flatMap((s) => s.clips)
        .filter((c) => c.ballToss?.version === BALL_TOSS_VERSION && matching(c, selected))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 12)
        .map((c) => c.ballToss);
      if (request !== generation) return;
      const spread = (key) => {
        const values = all.map((item) => item[key]).filter(Number.isFinite);
        if (values.length < 2) return null;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(
          values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
        );
      };
      const heights = spread("heightAboveHeadPct"),
        drifts = spread("driftFromHeadPct");
      history.textContent =
        heights !== null && drifts !== null
          ? `Last ${all.length} scanned clips with ${tripodName(selected.tripodPosition).toLowerCase()} setup. Height variation (SD): ${heights.toFixed(1)} percentage points of frame height. Drift variation (SD): ${drifts.toFixed(1)} percentage points of frame width.`
          : "Scan at least two clear tosses filmed from the same labeled setup to compare consistency.";
    } catch {
      if (request === generation) history.textContent = "Couldn’t read toss history.";
    }
  }
  function select(next) {
    generation++;
    controller?.abort();
    controller = null;
    clip = next;
    button.textContent = "Scan toss";
    button.disabled = !clip || clip.restoredWithoutVideo || !Number.isFinite(clip.sync?.offsetMs);
    history.textContent = "";
    if (clip?.ballToss?.version === BALL_TOSS_VERSION) render(clip.ballToss);
    else
      status.textContent = !clip
        ? "Choose a saved recording."
        : clip.restoredWithoutVideo
          ? "The original video is needed to scan a toss."
          : button.disabled
            ? "Open Replay first to align this clip’s tracking."
            : "";
    if (clip) showHistory(clip, generation);
  }
  button.addEventListener("click", async () => {
    if (controller) {
      controller.abort();
      return;
    }
    const selected = clip,
      request = generation;
    const task = new AbortController();
    controller = task;
    button.textContent = "Cancel scan";
    status.textContent = "Scanning the toss on this device…";
    let url, scanner;
    try {
      const [frames, { blob }] = await Promise.all([
        store.getClipPoses(selected.id),
        store.getClipVideo(selected, { playback: true }),
      ]);
      if (task.signal.aborted) throw new Error("cancelled");
      if (!blob.size) throw new Error("empty");
      url = URL.createObjectURL(blob);
      scanner = video.cloneNode();
      section.append(scanner);
      const result = await scanBallToss(scanner, url, frames, selected, task.signal);
      if (request !== generation) return;
      if (task.signal.aborted) throw new Error("cancelled");
      if (result) {
        await store.updateClip(selected.id, { ballToss: result });
        if (request !== generation) return;
        clip = { ...selected, ballToss: result };
      }
      render(result || clip.ballToss);
      showHistory(clip, request);
    } catch {
      if (request === generation)
        status.textContent = task.signal.aborted
          ? "Scan cancelled."
          : "This video could not be scanned.";
    } finally {
      if (scanner) {
        scanner.pause();
        scanner.removeAttribute("src");
        scanner.load();
        scanner.remove();
      }
      if (url) URL.revokeObjectURL(url);
      if (request === generation) {
        controller = null;
        button.textContent = "Scan toss";
      }
    }
  });
  window.addEventListener("pagehide", () => select(null));
  window.addEventListener("hashchange", () => {
    if (location.hash !== "#progress") select(null);
  });
  select(null);
  return select;
}
