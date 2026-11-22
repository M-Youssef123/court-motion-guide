import { buildClipAnalysis } from './practice-data.js';

export const BACKUP_FORMAT = 'serve-coach-practice';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const validId = (value) => typeof value === 'string' && /^[\w-]{1,120}$/.test(value) &&
  !Object.prototype.hasOwnProperty.call(Object.prototype, value);
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const number = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const definedNumber = (value, low, high) => value == null || number(value, low, high);
const invalid = (name) => { throw new Error(`Invalid ${name} in this Serve Coach backup.`); };

export function buildBackup(records) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), media: 'metadata-only', ...records };
}

export function validateBackup(backup) {
  if (backup?.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || backup.media !== 'metadata-only' || !date(backup.createdAt)) {
    throw new Error('Choose a supported Serve Coach JSON practice backup.');
  }
  const records = {};
  for (const [name, key] of [['sessions', 'id'], ['clips', 'id'], ['notes', 'id'], ['analyses', 'clipId'], ['poses', null], ['drills', null]]) {
    if (!Array.isArray(backup[name])) invalid(name);
    records[name] = backup[name];
    for (const item of records[name]) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || item.deletedAt || (key && !validId(item[key]))) invalid(name);
    }
  }
  const unique = (name, keys) => {
    const ids = new Set();
    for (const item of records[name]) {
      const id = JSON.stringify(keys.map((key) => item[key]));
      if (ids.has(id)) invalid(`duplicate ${name}`);
      ids.add(id);
    }
  };
  unique('sessions', ['id']); unique('clips', ['id']); unique('notes', ['id']);
  unique('poses', ['clipId', 'seq']); unique('analyses', ['clipId']); unique('drills', ['id']);
  const sessionIds = new Set(records.sessions.map((session) => session.id));
  const clips = new Map(records.clips.map((clip) => [clip.id, clip]));
  for (const session of records.sessions) {
    if (!date(session.createdAt) || !['active', 'ended'].includes(session.status)) invalid('session metadata');
  }
  for (const clip of records.clips) {
    const video = clip.video;
    if (!sessionIds.has(clip.sessionId) || !date(clip.createdAt) ||
        !Number.isSafeInteger(clip.seq) || clip.seq < 1 ||
        !['saved', 'interrupted', 'interrupted-empty'].includes(clip.status) ||
        !definedNumber(video?.durationMs, 0, 86400000) ||
        !definedNumber(video?.width, 0, 32768) || !definedNumber(video?.height, 0, 32768) ||
        !definedNumber(clip.sync?.offsetMs, -60000, 60000)) invalid('clip metadata');
  }
  for (const note of records.notes) {
    if (!date(note.createdAt) || typeof note.text !== 'string' || (note.sessionId != null && !sessionIds.has(note.sessionId))) invalid('note');
  }
  const frames = new Map();
  for (const pose of [...records.poses].sort((a, b) => a.seq - b.seq)) {
    if (!clips.has(pose.clipId) || !Number.isSafeInteger(pose.seq) || pose.seq < 0 || !Array.isArray(pose.frames)) invalid('pose batch');
    if (!frames.has(pose.clipId)) frames.set(pose.clipId, []);
    const timeline = frames.get(pose.clipId);
    for (const sample of pose.frames) {
      if (!number(sample?.t, timeline.at(-1)?.t ?? 0, 86400000) ||
          !(sample.kp === null || (Array.isArray(sample.kp) && sample.kp.length === 51 &&
          sample.kp.every((v, i) => i % 3 === 2 ? number(v, 0, 1) : number(v, -5, 5))))) invalid('pose frame');
      timeline.push(sample);
    }
  }
  for (const analysis of records.analyses) {
    if (clips.get(analysis.clipId)?.sessionId !== analysis.sessionId) invalid('analysis link');
  }
  for (const drill of records.drills) {
    if (!clips.has(drill.clipId) || !validId(drill.drillId) || !date(drill.completedAt) ||
        drill.id !== JSON.stringify([drill.drillId, drill.clipId])) invalid('drill completion');
  }
  // This metadata-only archive cannot verify pixel-derived findings against original video.
  records.clips = records.clips.map(({ ballToss: _ballToss, ...clip }) => clip);
  // Rebuild derived observations from validated poses. A backup cannot supply its own conclusions.
  const prior = new Map(records.analyses.map((analysis) => [analysis.clipId, analysis]));
  records.analyses = records.clips.map((clip) => {
    const saved = prior.get(clip.id);
    const arm = saved?.handSource === 'replay-preference-fallback' ? saved.dominantHand : undefined;
    const savedOffset = saved?.timebase?.videoOffsetMs;
    const offsetMs = clip.sync?.offsetMs ?? (number(savedOffset, -60000, 60000) ? savedOffset : 0);
    return buildClipAnalysis(clip, frames.get(clip.id) || [], { ...(arm ? { arm } : {}), offsetMs });
  });
  return records;
}
