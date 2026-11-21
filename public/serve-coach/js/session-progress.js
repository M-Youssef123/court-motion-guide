import { getJournalData } from './store.js';

const dateLabel = (s) => new Date(s.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const round = (n) => n.toFixed(1);

function setupKey(clip, analysis) {
  if (clip.source === 'upload' || !clip.tripodPosition || clip.tripodPosition === 'unknown' ||
      !clip.side || !clip.camera?.facing || !clip.video?.orientation || analysis.handSource !== 'recorded') return null;
  return JSON.stringify([clip.strokeType || 'serve', analysis.dominantHand, clip.tripodPosition,
    clip.side, clip.camera.facing, clip.video.orientation]);
}

export function comparisonSeries(data, selectedId) {
  const byClip = new Map(data.analyses.map((a) => [a.clipId, a]));
  const samples = [];
  for (const clip of data.clips) {
    const analysis = byClip.get(clip.id);
    const angle = analysis?.coaching?.positive?.evidence?.elbowAngleDegrees;
    if (analysis?.coaching?.status !== 'supported' || !Number.isFinite(angle)) continue;
    samples.push({ clip, angle, key: setupKey(clip, analysis) });
  }
  const newest = samples.filter(({ key }) => key).sort((a, b) => b.clip.createdAt.localeCompare(a.clip.createdAt));
  const anchor = selectedId ? samples.find(({ clip }) => clip.id === selectedId) : newest[0];
  if (!anchor?.key) return [];
  const bySession = groupBySession(newest);
  return [...data.sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).flatMap((session) => {
    const angles = (bySession.get(session.id) || []).filter((s) => s.key === anchor.key).map((s) => s.angle);
    if (!angles.length) return [];
    const mean = angles.reduce((sum, n) => sum + n, 0) / angles.length;
    const spread = angles.length > 1 ? Math.sqrt(angles.reduce((sum, n) => sum + (n - mean) ** 2, 0) / angles.length) : null;
    return [{ session, mean, spread, count: angles.length }];
  });
}

function groupBySession(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const id = sample.clip.sessionId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(sample);
  }
  return groups;
}

export function comparisonText(series, mode, selectedSession) {
  const i = selectedSession ? series.findIndex(({ session }) => session.id === selectedSession) : series.length - 1;
  if (i < 1) return 'At least two practices with reliable overhead reach and matching recorded camera setups are needed.';
  const latest = series[i], earlier = series[mode === 'first' ? 0 : i - 1];
  const change = latest.mean - earlier.mean;
  const sign = change >= 0 ? '+' : '−';
  const consistency = latest.spread === null || earlier.spread === null
    ? 'At least two supported clips in each practice are needed to compare consistency.'
    : `Within-practice standard deviation was ${round(earlier.spread)}° and is now ${round(latest.spread)}°.`;
  return `Mean 2D elbow angle at overhead reach changed from ${round(earlier.mean)}° on ${dateLabel(earlier.session)} to ${round(latest.mean)}° on ${dateLabel(latest.session)} (${sign}${round(Math.abs(change))}°, ${earlier.count} and ${latest.count} tracked clips). ${consistency}`;
}

export function initSessionProgress() {
  const list = document.getElementById('sessions');
  const comparison = document.getElementById('comparisonSummary');
  const graph = document.getElementById('comparisonGraph');
  let mode = 'last', series = [], request = 0;
  const paint = () => { comparison.textContent = comparisonText(series, mode); };
  document.querySelectorAll('[data-cmp]').forEach((button) => button.addEventListener('click', () => {
    mode = button.dataset.cmp;
    document.querySelectorAll('[data-cmp]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    paint();
  }));
  return async function render() {
    const token = ++request;
    try {
      const data = await getJournalData();
      if (request !== token) return;
      series = comparisonSeries(data);
      paint();
      graph.replaceChildren();
      graph.hidden = !series.length;
      for (const row of series) {
        const label = document.createElement('label');
        label.className = 'sess';
        label.textContent = `${dateLabel(row.session)} · ${round(row.mean)}° · ${row.count} tracked clip${row.count === 1 ? '' : 's'} `;
        const bar = document.createElement('meter');
        bar.min = 0; bar.max = 180; bar.value = row.mean;
        label.append(bar);
        graph.append(label);
      }
      list.replaceChildren();
      for (const session of data.sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
        const clips = data.clips.filter((clip) => clip.sessionId === session.id && clip.status !== 'recording');
        const seconds = Math.round(clips.reduce((sum, clip) => sum + (clip.video?.durationMs || 0), 0) / 1000);
        const row = document.createElement('li');
        row.className = 'sess';
        row.textContent = `${dateLabel(session)} · ${clips.length} saved clip${clips.length === 1 ? '' : 's'} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        list.append(row);
      }
      document.getElementById('sessionsEmpty').hidden = Boolean(list.childElementCount);
    } catch {
      if (request === token) comparison.textContent = 'Saved practice data could not be opened. Reopen Progress to retry.';
    }
  };
}
