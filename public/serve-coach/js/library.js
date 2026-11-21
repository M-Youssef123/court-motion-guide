/*
 * library.js — Progress → Video recordings (MVP1 Stage B).
 *
 * Lists practice sessions newest first, each with its clips. Tapping a clip opens Replay.
 * A whole practice can be deleted (two taps). Everything lives only on this device.
 */

import * as store from './store.js';
import { planText } from './practice.js';
import { tripodName } from './labels.js';
import { saveVideo, clipFilename } from './save-video.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtMB = (b) => (b / 1e6 >= 10 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB';
const sideName = (s) => (s === 'ad' ? 'Ad' : s === 'deuce' ? 'Deuce' : '–');
const camName = (c) => (c && c.facing === 'user' ? 'Front' : 'Rear');
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function initLibrary({ openClip, onDeleted }) {
  let token = 0;

  async function render() {
    const my = ++token;
    const [sessions, st] = await Promise.all([store.listSessions(), store.storageStatus()]);
    if (my !== token) return;
    const list = $('libList');
    list.innerHTML = '';
    const withClips = sessions.filter((s) => s.clips.some((c) => c.status !== 'recording'));
    $('libEmpty').hidden = withClips.length > 0;
    withClips.forEach((s) => list.appendChild(sessionCard(s)));

    let line = `Stored only on this device · ${fmtMB(st.ourMB * 1e6)} used`;
    if (st.freeMB != null && !isIOS()) line += ` · about ${st.freeMB >= 1000 ? (st.freeMB / 1000).toFixed(1) + ' GB' : Math.round(st.freeMB) + ' MB'} free`;
    $('libStorage').textContent = line;
    $('libTip').hidden = !(isIOS() && !standalone() && st.persisted !== true);
  }

  /* Separate bar under each clip: saves the original recording (blob loaded up front so iOS keeps the tap). */
  function saveBar(c) {
    const bar = document.createElement('div'); bar.className = 'lib-save';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lib-save-btn'; b.disabled = true;
    b.textContent = 'Loading…';
    const msg = document.createElement('span'); msg.className = 'lib-save-msg'; msg.setAttribute('aria-live', 'polite');
    bar.append(b, msg);
    let blob = null, timer = null;
    const label = 'Download video';
    store.getClipVideo(c).then((r) => {
      if (r.blob && r.blob.size) { blob = r.blob; b.disabled = false; b.textContent = label; }
      else b.textContent = 'No video saved';
    }).catch(() => { b.textContent = 'Video unavailable'; });
    const reset = () => { timer = setTimeout(() => { b.disabled = false; b.textContent = label; msg.textContent = ''; }, 5000); };
    b.addEventListener('click', () => {
      if (!blob) return;
      clearTimeout(timer);
      const name = clipFilename(new Date(c.createdAt), blob.type || (c.video && c.video.mime));
      b.disabled = true; b.textContent = 'Preparing video…'; msg.textContent = '';
      saveVideo(blob, name).then((r) => {
        b.disabled = false;
        if (r === 'cancelled') { b.textContent = label; msg.textContent = 'Not saved'; }
        else { b.textContent = 'Saved ✓'; msg.textContent = r === 'shared' ? 'Tap “Save Video” to keep it in Photos' : name; }
        reset();
      }).catch(() => { b.disabled = false; b.textContent = label; msg.textContent = 'Couldn’t save. Try again.'; reset(); });
    });
    return bar;
  }

  function sessionCard(s) {
    const clips = s.clips.filter((c) => c.status !== 'recording');
    const li = document.createElement('li');
    li.className = 'lib-session';
    const head = document.createElement('div'); head.className = 'lib-head';
    const title = document.createElement('h3');
    title.textContent = new Date(s.createdAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const total = clips.reduce((n, c) => n + ((c.video && c.video.durationMs) || 0), 0);
    const bytes = clips.reduce((n, c) => n + ((c.video && c.video.bytes) || 0), 0);
    const d = clips.filter((c) => c.side === 'deuce').length, a = clips.filter((c) => c.side === 'ad').length;
    const sub = document.createElement('p'); sub.className = 'lib-sub';
    sub.textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'} · ${[d && `Deuce ${d}`, a && `Ad ${a}`].filter(Boolean).join(' · ')} · ${fmtTime(total)} · ${fmtMB(bytes)}`;
    const pos = ['behind', 'side', 'unknown'].map((p) => [p, clips.filter((c) => (c.tripodPosition || 'unknown') === p).length]).filter(([, n]) => n);
    sub.textContent += ` · Tripod: ${pos.map(([p, n]) => `${tripodName(p)} ${n}`).join(', ')}`;
    if (s.plan) sub.textContent += ` · Plan: ${planText(s.plan)}`;
    head.append(title);
    if (s.status === 'active') { const tag = document.createElement('span'); tag.className = 'lib-tag'; tag.textContent = 'In progress'; head.append(tag); }
    li.append(head, sub);

    const ul = document.createElement('ul'); ul.className = 'lib-clips';
    clips.forEach((c) => {
      const row = document.createElement('li');
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'lib-clip';
      const name = document.createElement('b'); name.textContent = `Clip ${c.seq} · ${sideName(c.side)}`;
      const meta = document.createElement('span');
      meta.textContent = c.source === 'upload' ? `Uploaded video${c.fileName ? ' · ' + c.fileName : ''} · ${fmtTime((c.video && c.video.durationMs) || 0)}` : `Tripod ${tripodName(c.tripodPosition)} · ${camName(c.camera)} camera · ${fmtTime((c.video && c.video.durationMs) || 0)}` +
        (c.status === 'interrupted-empty' ? ' · no video saved' : c.status === 'interrupted' ? ' · interrupted' : '');
      const go = document.createElement('span'); go.className = 'lib-go'; go.textContent = c.restoredWithoutVideo ? 'Analysis only' : 'Replay ›';
      btn.disabled = Boolean(c.restoredWithoutVideo);
      btn.append(name, meta, go);
      btn.addEventListener('click', () => openClip(c.id));
      row.appendChild(btn);
      if (c.status !== 'interrupted-empty' && !c.restoredWithoutVideo) row.appendChild(saveBar(c));
      ul.appendChild(row);
    });
    li.appendChild(ul);

    if (s.status !== 'active') {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-danger lib-del'; del.textContent = 'Delete practice';
      let t = null;
      del.addEventListener('click', async () => {
        if (!del.classList.contains('armed')) {
          del.classList.add('armed'); del.textContent = `Tap again to delete practice, ${clips.length} clip${clips.length === 1 ? '' : 's'} and notes`;
          t = setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Delete practice'; }, 4000);
          return;
        }
        clearTimeout(t);
        await store.deleteSession(s.id);
        render();
        onDeleted?.();
      });
      li.appendChild(del);
    }
    return li;
  }

  return { render };
}
