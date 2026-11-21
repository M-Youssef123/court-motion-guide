/*
 * app.js — routing, navigation and screen interactions.
 *
 * Five-step journey: #home → #practice → #camera → #ready → #record; #hand (one-time
 * handedness); #progress and #replay. Old links: #live → #record, #setup → #camera,
 * #log and #coach → #progress.
 *
 * Camera: runs only on Readiness and on the Record screen (each has its own Preview).
 * Leaving the screen, or hiding the page, stops it. Record screen: record.js.
 *
 * Demo-only behaviour still in place:
 *   - example comparisons and sessions in Progress (below the real
 *     Video recordings library)
 */

import { KEYS, prefs, recoverUnfinishedClips, markUnknownTripodPositions } from './store.js';
import { probeCamera, CAMERA_TEST_VARIANTS } from './camera.js';
import { MIN_DRAW_SCORE } from './overlay.js';
import { Preview } from './preview.js';
import { initRecord } from './record.js';
import { initReplay } from './replay.js';
import { initLibrary } from './library.js';
import { initPractice, planText } from './practice.js';
import { tripodName } from './labels.js';
import { getPoseInfo } from './pose.js';
import * as store from './store.js';
import { initDebug } from './debug.js';
import { initUpload } from './upload.js';
import { initNotes } from './notes.js';
import { initJournalExport } from './journal-export.js';
import { initProgressCoaching } from './progress-coaching.js';

const $ = (id) => document.getElementById(id);

/* ---------- routing ----------
 * Five-step journey: Start (#home) → Practice (#practice) → Camera setup (#camera) →
 * Readiness (#ready) → Record (#record). #hand is the one-time handedness question (not a
 * numbered step). Progress (#progress) and Replay (#replay) are destinations afterwards.
 */
const VIEWS = ['home', 'hand', 'practice', 'camera', 'ready', 'record', 'progress', 'replay'];
let currentView = null;
const ALIASES = { live: 'record', log: 'progress', coach: 'progress', setup: 'camera' };
const TAB_FOR = { home: 'home', hand: 'record', practice: 'record', camera: 'record', ready: 'record', record: 'record', progress: 'progress', replay: 'progress' };

function go(h) { location.hash = '#' + h; }

function route() {
  let h = (location.hash || '#home').slice(1);
  if (ALIASES[h]) { h = ALIASES[h]; history.replaceState(null, '', '#' + h); }
  if (VIEWS.indexOf(h) < 0) h = 'home';
  if (h === 'practice' && !profile().hand) { handReturn = 'practice'; h = 'hand'; history.replaceState(null, '', '#hand'); }
  if (h === 'replay' && !replay.hasClip()) { h = 'progress'; history.replaceState(null, '', '#progress'); }
  const prev = currentView;
  currentView = h;
  if (h !== 'ready') stopPreview();
  if (prev === 'record' && h !== 'record') record.leave();
  if (prev === 'replay' && h !== 'replay') replay.leave();
  if (prev === 'progress' && h !== 'progress') coaching.stop();
  VIEWS.forEach((v) => { $(v).hidden = v !== h; });
  const tab = TAB_FOR[h];
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (h === 'hand') enterHand();
  if (h === 'camera') enterCamera();
  if (h === 'ready') enterReady();
  if (h === 'record' && prev !== 'record') record.enter();
  if (h === 'progress') { library.render(); notes.render(); coaching.render(); }
  if (h === 'practice') practice.enter();
  if (h === 'home') renderHome();
  if (h === 'replay') replay.enter();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function say(text, force) {
  if (force !== 'force') return; // spoken only when explicitly requested
  try {
    const s = window.speechSynthesis;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    s.speak(u);
  } catch (e) { /* speech not available */ }
}

function pick(attr, val) {
  document.querySelectorAll('[data-' + attr + ']').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset[attr] === val));
  });
}

/* ---------- handedness: asked once, saved to the local profile, editable from Home ---------- */
// Used only for guidance (which side of the court the tripod goes). Copied onto each new
// session. Never mirrors or changes movement data.
const profile = () => prefs.get(KEYS.profile) || {};
let handReturn = 'home';
let handChoice = null;
function enterHand() {
  handChoice = profile().hand || null;
  pick('hand', handChoice || '');
  $('handSave').disabled = !handChoice;
}
document.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => {
  handChoice = b.dataset.hand; pick('hand', handChoice); $('handSave').disabled = false;
}));
$('handSave').addEventListener('click', () => {
  if (!handChoice) return;
  prefs.set(KEYS.profile, { ...profile(), hand: handChoice, handSetAt: new Date().toISOString() });
  const back = handReturn; handReturn = 'home';
  go(back);
});

/* ---------- Step 3: camera setup ----------
 * Tripod position (physical place on court) and phone camera (rear/front) are separate
 * settings. Last time's values are offered as a suggestion; the player must confirm them
 * ("Yes, same setup") or choose again. Nothing is assumed silently.
 */
const cfg = prefs.get(KEYS.cfg) || {};   // last used: side (guide), position, from earlier versions too
let camSession = null;                   // active practice session
let camPos = null, camFace = null;

function layout() {
  const right = (profile().hand || 'R') === 'R';
  const side = (camSession && camSession.plan && camSession.plan.sides === 'ad') ? 'ad' : (cfg.side || 'deuce');
  const px = side === 'deuce' ? 77 : 63;
  const behind = camPos === 'behind';
  $('s2Title').innerHTML = behind ? 'Put the tripod behind you' : 'Put the tripod side&#8209;on';
  $('s2Text').textContent = behind ? 'From behind, the camera looks past you towards the net.' : 'From the side, the camera sees your whole body side-on.';
  $('tipsBehind').hidden = !behind;
  $('tipsSide').hidden = behind;
  if (behind) {
    $('player').querySelector('circle').setAttribute('cx', px);
    $('player').querySelector('text').setAttribute('x', px + 13);
    $('player').querySelector('text').setAttribute('y', 135);
    $('tripod').querySelector('circle').setAttribute('cx', px);
    $('tripod').querySelector('circle').setAttribute('cy', 160);
    $('tripT').setAttribute('x', px + 9); $('tripT').setAttribute('y', 162); $('tripT').setAttribute('text-anchor', 'start');
    $('cone').setAttribute('points', px + ',160 ' + (px - 13) + ',96 ' + (px + 13) + ',96');
    $('sight').setAttribute('x1', px); $('sight').setAttribute('x2', px);
    $('sight').setAttribute('y1', 160); $('sight').setAttribute('y2', 96);
    $('distOut').firstChild.nodeValue = 'About 3–4 m behind you';
    $('distSteps').textContent = 'roughly 4–5 big steps';
    $('farNote').hidden = true;
    return;
  }
  $('player').querySelector('text').setAttribute('y', 146);
  $('tripod').querySelector('circle').setAttribute('cy', 133);
  $('tripT').setAttribute('y', 124);
  $('sight').setAttribute('y1', 133); $('sight').setAttribute('y2', 133);
  const cx = right ? 131 : 9;
  $('player').querySelector('circle').setAttribute('cx', px);
  $('player').querySelector('text').setAttribute('x', px);
  $('tripod').querySelector('circle').setAttribute('cx', cx);
  $('tripT').setAttribute('x', right ? 136 : 4);
  $('tripT').setAttribute('text-anchor', right ? 'end' : 'start');
  $('cone').setAttribute('points', cx + ',133 ' + px + ',123 ' + px + ',143');
  $('sight').setAttribute('x1', cx);
  $('sight').setAttribute('x2', px);
  const far = Math.abs(cx - px) / 10 > 6;
  $('distOut').firstChild.nodeValue = far ? 'About 7 m' : 'About 5 m';
  $('distSteps').textContent = far ? 'roughly 8 big steps' : 'roughly 6 big steps';
  $('sideTip').textContent = 'On your ' + (right ? 'right' : 'left') + ', the side your chest faces';
  $('farNote').hidden = !far;
}

function paintCamera() {
  pick('pos', camPos || '');
  pick('face', camFace || '');
  const btn = $('camConfirm');
  btn.disabled = !camPos || !camFace;
  btn.textContent = !camPos ? 'Choose where your tripod is' : !camFace ? 'Choose the phone camera'
    : `Confirm: ${tripodName(camPos)} · ${camFace === 'user' ? 'Front' : 'Rear'} camera`;
  layout();
}

async function enterCamera() {
  camSession = await store.getActiveSession();
  if (currentView !== 'camera') return;
  if (!camSession) { go('practice'); return; }
  const lastPos = (prefs.get(KEYS.cfg) || {}).position || null;
  const lastFace = prefs.get(KEYS.camera) || null;
  const hasLast = !!(lastPos && lastFace);
  $('camLast').hidden = !hasLast;
  $('camPick').hidden = hasLast;
  if (hasLast) $('camLastText').textContent = `${tripodName(lastPos)} · ${lastFace === 'user' ? 'Front' : 'Rear'} camera`;
  // When choosing, nothing is preselected for the tripod; the phone camera starts on Rear.
  camPos = null; camFace = lastFace || 'environment';
  $('camGuide').open = !hasLast;
  paintCamera();
}
$('camChange').addEventListener('click', () => {
  const lastPos = (prefs.get(KEYS.cfg) || {}).position || null;
  camPos = lastPos; // shown as the starting point; the player still confirms
  $('camLast').hidden = true; $('camPick').hidden = false;
  paintCamera();
});
$('camSame').addEventListener('click', () => {
  camPos = (prefs.get(KEYS.cfg) || {}).position; camFace = prefs.get(KEYS.camera);
  confirmCamera('same as last time');
});
document.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => { camPos = b.dataset.pos; paintCamera(); }));
document.querySelectorAll('[data-face]').forEach((b) => b.addEventListener('click', () => { camFace = b.dataset.face; paintCamera(); }));
$('camConfirm').addEventListener('click', () => confirmCamera('chosen'));

async function confirmCamera(how) {
  if (!camSession || !camPos || !camFace) return;
  const cameraSetup = { tripodPosition: camPos, facing: camFace, how, confirmedAt: new Date().toISOString() };
  await store.updateSession(camSession.id, { cameraSetup });
  prefs.set(KEYS.cfg, { ...(prefs.get(KEYS.cfg) || {}), position: camPos });
  prefs.set(KEYS.camera, camFace);
  record.setTripod(camPos);
  record.setFacing(camFace);
  go('ready');
}

/* ---------- Step 4: readiness (live preview + skeleton) ----------
 * Hybrid rule: only a missing camera picture blocks going on. Tracking problems are shown as
 * warnings. (Automatic framing checks arrive in Phase B.)
 */
let debugTarget = null; // the preview the debug panel follows
const debug = initDebug({ getTarget: () => debugTarget, minScore: MIN_DRAW_SCORE, cameraTest: runCameraTest });
let lastGood = 0, lastGoodAt = 0;
const setupPreview = new Preview(
  { video: $('cameraPreview'), canvas: $('skeletonCanvas'), box: $('setupBox'), status: $('camStatus'), retry: $('camRetry') },
  { debug, onPoses: (poses) => {
    const p = poses && poses[0];
    lastGood = p ? p.keypoints.filter((k) => k.score >= MIN_DRAW_SCORE).length : 0;
    lastGoodAt = performance.now();
  } },
);
debugTarget = { video: setupPreview.video, canvas: $('skeletonCanvas'), overlay: setupPreview.overlay };
let readyTimer = null;
let readySession = null;

function readyState() {
  const el = $('readyState');
  const camOk = setupPreview.cameraOn;
  let s, t;
  if (!camOk) { s = setupPreview.on ? 'wait' : 'block'; t = setupPreview.on ? 'Starting the camera…' : 'The camera isn’t working, so you can’t record yet.'; }
  else if (setupPreview.trackingFailed) { s = 'warn'; t = 'Body tracking isn’t available. You can still record video; it won’t have movement data.'; }
  else if (!getPoseInfo().running) { s = 'wait'; t = 'Loading body tracking…'; }
  else if (performance.now() - lastGoodAt > 1500 || lastGood < 5) { s = 'warn'; t = 'Camera working. Stand at your serving spot so I can see you.'; }
  else if (lastGood < 13) { s = 'warn'; t = 'I can see part of you. Make sure you’re in the picture head to feet.'; }
  else { s = 'ok'; t = 'Camera working and tracking your body.'; }
  if (el.dataset.s !== s || el.textContent !== t) { el.dataset.s = s; el.textContent = t; }
  $('readyGo').disabled = !camOk;
}

async function enterReady() {
  readySession = await store.getActiveSession();
  if (currentView !== 'ready') return;
  if (!readySession) { go('practice'); return; }
  if (!readySession.cameraSetup) { go('camera'); return; }
  const cs = readySession.cameraSetup;
  const plan = readySession.plan;
  $('readySetup').textContent = `Tripod ${tripodName(cs.tripodPosition)} · ${cs.facing === 'user' ? 'Front' : 'Rear'} camera${plan ? ' · ' + planText(plan) : ''}`;
  startPreview();
  clearInterval(readyTimer);
  readyTimer = setInterval(readyState, 300);
  readyState();
}
$('readyGo').addEventListener('click', () => { if (setupPreview.cameraOn) go('record'); });

/** Debug only: stop the preview, try each camera request in turn, then restart the preview. */
async function runCameraTest() {
  const wasReady = currentView === 'ready';
  stopPreview();
  if (currentView === 'record') record.preview.stop(true);
  const results = [];
  for (const v of CAMERA_TEST_VARIANTS) results.push(await probeCamera(v));
  if (wasReady) startPreview();
  if (currentView === 'record') record.preview.start();
  return results;
}
function startPreview() {
  debugTarget = { video: setupPreview.video, canvas: $('skeletonCanvas'), overlay: setupPreview.overlay };
  const face = (readySession && readySession.cameraSetup && readySession.cameraSetup.facing) || prefs.get(KEYS.camera) || 'environment';
  return setupPreview.start(face);
}
function stopPreview() { clearInterval(readyTimer); setupPreview.stop(); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPreview();
  else if (currentView === 'ready') enterReady();
});
window.addEventListener('pagehide', stopPreview);

/* ---------- record, replay, library, practice ---------- */
const replay = initReplay();
const coaching = initProgressCoaching({ openMoment: (id, poseMs) => replay.openMoment(id, poseMs) });
initUpload({ openClip: (id) => replay.open(id) });
const library = initLibrary({ openClip: (id) => replay.open(id) });
const notes = initNotes();
initJournalExport();
const record = initRecord({ debug, openClip: (id) => replay.open(id, 'record') });
const practice = initPractice({
  getHand: () => profile().hand || null,
  onStart(session, firstSide) {
    cfg.side = firstSide;
    prefs.set(KEYS.cfg, { ...(prefs.get(KEYS.cfg) || {}), side: firstSide });
    record.setSide(firstSide);
    go('camera');
  },
});

/* ---------- home ---------- */
async function renderHome() {
  const hand = profile().hand;
  $('homeHand').hidden = !hand;
  if (hand) $('homeHand').innerHTML = `You serve ${hand === 'L' ? 'left' : 'right'}-handed · <a class="link" href="#hand">Change</a>`;
  const s = (await store.listSessions()).find((x) => x.clips.some((c) => c.status !== 'recording'));
  const el = $('homeRecent');
  if (!s) { el.textContent = 'No practice sessions yet.'; return; }
  const clips = s.clips.filter((c) => c.status !== 'recording');
  const secs = Math.round(clips.reduce((n, c) => n + ((c.video && c.video.durationMs) || 0), 0) / 1000);
  el.textContent = `${new Date(s.createdAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${clips.length} clip${clips.length === 1 ? '' : 's'} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${s.plan ? ' · ' + planText(s.plan) : ''}${s.status === 'active' ? ' · in progress' : ''}`;
}
$('homeHand').addEventListener('click', (e) => { if (e.target.closest('a')) handReturn = 'home'; });
const recordDebugTarget = { video: $('recVideo'), canvas: $('recCanvas'), overlay: record.preview.overlay };
const _enter = record.enter;
record.enter = () => { debugTarget = recordDebugTarget; return _enter(); };

/* ---------- progress: comparisons and sessions (example content) ---------- */
const cmp = {
  last: ['Your toss stayed put on every serve', 'Shoulder turn still fades near the end', 'Front knee over your ankle'],
  first: ['Your toss no longer drifts forward, and more serves land in', 'Toss height is steady, just as it was', 'Front knee over your ankle'],
};
document.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => {
  const c = cmp[b.dataset.cmp];
  document.querySelectorAll('[data-cmp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('vBetter').textContent = c[0];
  $('vSame').textContent = c[1];
  $('vNext').textContent = c[2];
}));

const exampleSessions = [
  { d: 'Example 3', main: 'Front knee', chip: 'fix', r: 'iiioioioii', f: [4, 6, 8, 9, 10] },
  { d: 'Example 2', main: 'Shoulder turn', chip: 'watch', r: 'iiioioiioo', f: [4, 8, 9, 10] },
  { d: 'Example 1', main: 'Toss drift', chip: 'watch', r: 'iooiioiooo', f: [2, 3, 5, 6, 8, 10] },
];
$('sessions').innerHTML = exampleSessions.map((s) => {
  const balls = s.r.split('').map((c, k) => '<span class="b' + (c === 'o' ? ' out' : '') + (s.f.indexOf(k + 1) >= 0 ? ' flag' : '') + '"></span>').join('');
  const ins = s.r.split('i').length - 1;
  return '<li class="sess"><div class="sess-top"><b>' + s.d + '</b><span class="chip ' + s.chip + '">' + s.main + '</span></div><div class="balls" role="img" aria-label="' + ins + ' of 10 serves in, ' + s.f.length + ' flagged">' + balls + '</div></li>';
}).join('');

recoverUnfinishedClips().then(markUnknownTripodPositions).then(store.backfillPracticeData).then(() => { if (currentView === 'progress') coaching.render(); }).catch(() => {}); // recover/backfill saved data on-device without rerunning body tracking
route();
