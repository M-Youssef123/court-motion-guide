import * as store from "./store.js";
import { initTraining } from "./training.js";
import { initPhaseComparison } from "./phase-comparison.js";

// Keep phase comparison and Coach topics independent of the removed insight panel.
export function initProgressCoaching() {
  const host = document.getElementById("coach");
  const comparison = initPhaseComparison(host);
  const picker = document.createElement("div");
  picker.innerHTML = `<label class="field-label" for="coachClip">Recording</label>
    <select class="input" id="coachClip"></select>
    <p class="kicker" id="coachSource" role="status" aria-live="polite"></p>`;
  const phaseSection = host.querySelector(".phase-comparison");
  phaseSection.querySelector(".seg").before(picker);
  const renderTraining = initTraining(host);
  const select = picker.querySelector("select");
  const source = picker.querySelector("#coachSource");
  let selected = null;
  let token = 0;

  function stop() {
    token++;
    comparison.clear();
  }
  window.addEventListener("pagehide", stop);

  async function load(id) {
    const request = ++token;
    selected = id;
    comparison.clear();
    renderTraining();
    source.textContent = "Loading recording…";
    try {
      const clip = await store.getClip(id);
      if (!clip || clip.deletedAt) throw new Error("missing");
      const analysis = await store.getClipAnalysis(id);
      if (request !== token) return;
      comparison.load(clip);
      renderTraining(clip, analysis?.coaching, analysis);
      source.textContent = `${new Date(clip.createdAt).toLocaleString()} · ${clip.source === "upload" ? "Uploaded footage" : "Recorded practice"}`;
    } catch {
      if (request === token) source.textContent = "Recording could not be read. Reopen Progress to try again.";
    }
  }
  select.addEventListener("change", () => load(select.value));

  async function render() {
    const request = ++token;
    comparison.clear();
    renderTraining();
    source.textContent = "Loading recordings…";
    try {
      const sessions = await store.listSessions();
      if (request !== token) return;
      const clips = sessions.flatMap((s) => s.clips)
        .filter((c) => !c.deletedAt && c.status !== "recording" && c.status !== "interrupted-empty")
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.seq - a.seq);
      select.replaceChildren();
      select.disabled = !clips.length;
      for (const clip of clips) {
        const option = document.createElement("option");
        option.value = clip.id;
        option.textContent = `${new Date(clip.createdAt).toLocaleString()} · Clip ${clip.seq}`;
        select.append(option);
      }
      if (!clips.length) {
        source.textContent = "No saved recordings yet.";
        return;
      }
      selected = clips.some((c) => c.id === selected) ? selected : clips[0].id;
      select.value = selected;
      await load(selected);
    } catch {
      if (request === token) source.textContent = "Recordings could not be read. Reopen Progress to try again.";
    }
  }
  return { render, stop };
}
