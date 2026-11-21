import * as store from './store.js';
import { COACHING_VERSION } from './coaching-insights.js';
import { initPhaseComparison } from './phase-comparison.js';

const HEAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
export function initProgressCoaching({ openMoment }) {
  const host = document.getElementById('coach');
  host.innerHTML = `<h2 class="sec-h" id="coachSecH">AI coaching insights</h2>
    <label class="field-label" for="coachClip">Recording</label>
    <select class="input" id="coachClip"></select>
    <p class="kicker" id="coachSource"></p>
    <p class="empty" id="coachStatus" role="status" aria-live="polite"></p>
    <div class="block" id="coachBody"></div>
    <button class="btn btn-quiet" type="button" id="hearBtn" disabled aria-pressed="false">${HEAR_ICON}Hear it</button>
    <p class="kicker">Observations are estimates from body tracking in this camera view. Ball accuracy, ball impact and measured racket speed cannot be determined.</p>`;
  const comparison = initPhaseComparison(host);
  const notice = document.querySelector('#progress > .notice');
  notice.textContent = 'Example comparisons and sessions below are illustrations, not your data.';
  document.getElementById('cmpH').parentElement.before(notice);
  const select = document.getElementById('coachClip'), body = document.getElementById('coachBody');
  const status = document.getElementById('coachStatus'), hear = document.getElementById('hearBtn');
  let selected = null, text = '', utterance = null, token = 0;
  function reset() { utterance = null; hear.innerHTML = HEAR_ICON + 'Hear it'; hear.setAttribute('aria-pressed', 'false'); }
  function stop() { const speaking = utterance; reset(); if (speaking) { try { window.speechSynthesis.cancel(); } catch {} } }
  hear.addEventListener('click', () => {
    if (utterance) { stop(); return; }
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.rate = 0.95; utterance = u;
      hear.innerHTML = STOP_ICON + 'Stop audio'; hear.setAttribute('aria-pressed', 'true');
      u.onend = () => { if (utterance === u) reset(); };
      u.onerror = () => { if (utterance === u) { reset(); status.textContent = 'Audio could not be played. Your observations are shown below.'; } };
      window.speechSynthesis.speak(u);
    } catch { reset(); status.textContent = 'Audio is unavailable on this device.'; }
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('hashchange', () => { if (location.hash !== '#progress') { token++; stop(); } });
  async function load(id) {
    const request = ++token; stop(); text = ''; hear.disabled = true; body.replaceChildren();
    comparison.clear();
    status.textContent = 'Reading saved movement data…'; selected = id;
    try {
      const clip = await store.getClip(id);
      if (!clip || clip.deletedAt) throw new Error('missing');
      let analysis = await store.getClipAnalysis(id);
      if (analysis?.coaching?.version !== COACHING_VERSION) analysis = await store.finalizeClipData(id);
      if (request !== token) return;
      comparison.load(clip);
      const feedback = analysis?.coaching;
      document.getElementById('coachSource').textContent = `${new Date(clip.createdAt).toLocaleString()} · ${clip.source === 'upload' ? 'Uploaded footage' : 'Recorded practice'}`;
      if (feedback?.status !== 'supported') {
        status.textContent = `Insufficient data for reliable coaching. ${feedback?.reason || 'No clear movement data is available.'}`;
        return;
      }
      status.textContent = 'One tracked overhead sequence in this recording; not a summary of every serve.';
      const spoken = [];
      for (const [key, label] of [['positive', 'What went well'], ['improvement', 'Potential improvement'], ['recommendation', 'Try next']]) {
        const section = document.createElement('article'); section.className = 'block';
        const h = document.createElement('h3'); h.className = 'sub-h'; h.textContent = label;
        const p = document.createElement('p'); const item = feedback[key];
        p.className = key === 'positive' ? 'praise' : 'fix-p';
        p.textContent = item?.text || 'No specific improvement is supported by this tracked sequence.';
        section.append(h, p);
        if (item) {
          const e = item.evidence;
          const source = document.createElement('p'); source.className = 'kicker';
          source.textContent = `Saved frame ${e.frameIndex + 1} · minimum landmark confidence ${Math.round(e.minLandmarkConfidence * 100)}%`;
          section.append(source);
          if (Number.isFinite(e.timestampMs)) {
            const b = document.createElement('button'); b.className = 'btn btn-quiet'; b.type = 'button';
            b.textContent = `▶ View estimated moment · ${(e.timestampMs / 1000).toFixed(3)} s`;
            b.addEventListener('click', () => { stop(); openMoment(id, e.poseTimestampMs); }); section.append(b);
          } else {
            source.textContent += ' · Video timing is not aligned yet; open Replay to align it.';
          }
          spoken.push(`${label}. ${item.text}${Number.isFinite(e.timestampMs) ? ` At approximately ${(e.timestampMs / 1000).toFixed(2)} seconds.` : ''}`);
        }
        body.append(section);
      }
      text = spoken.join(' '); hear.disabled = !text || !window.speechSynthesis;
    } catch {
      if (request === token) status.textContent = 'Saved coaching could not be read. Reopen Progress to try again.';
    }
  }
  select.addEventListener('change', () => load(select.value));
  async function render() {
    const request = ++token; stop(); hear.disabled = true; text = ''; body.replaceChildren();
    comparison.clear();
    document.getElementById('coachSource').textContent = ''; status.textContent = 'Loading recordings…';
    try {
      const sessions = await store.listSessions();
      if (request !== token) return;
      const clips = sessions.flatMap(s => s.clips).filter(c => !c.deletedAt && c.status !== 'recording' && c.status !== 'interrupted-empty')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.seq - a.seq);
      select.replaceChildren(); select.disabled = !clips.length;
      for (const clip of clips) {
        const option = document.createElement('option'); option.value = clip.id;
        option.textContent = `${new Date(clip.createdAt).toLocaleString()} · Clip ${clip.seq}`; select.append(option);
      }
      if (!clips.length) { status.textContent = 'Insufficient data for reliable coaching. Save a recording with clear body tracking first.'; return; }
      selected = clips.some(c => c.id === selected) ? selected : clips[0].id;
      select.value = selected; await load(selected);
    } catch { if (request === token) status.textContent = 'Recordings could not be read. Reopen Progress to try again.'; }
  }
  return { render, stop };
}