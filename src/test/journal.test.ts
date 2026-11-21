import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error static app module
import { buildJournal, journalFilename } from '../../public/serve-coach/js/journal.js';
// @ts-expect-error static app module
import * as store from '../../public/serve-coach/js/store.js';

const data = () => ({
  sessions: [{ id: 'session-1', date: '2026-11-21T12:00:00Z', dominantHand: 'right', status: 'ended' }],
  clips: [{ id: 'clip-1', sessionId: 'session-1', seq: 1, dominantHand: 'right', status: 'saved', video: { durationMs: 65000, secretVideoBytes: 'BINARY_VIDEO' }, poseFrames: [{ kp: 'RAW_LANDMARKS' }] }],
  notes: [{ id: 'note-1', sessionId: 'session-1', createdAt: '2026-11-21T12:05:00Z', text: 'Keep my toss steady\nFinish balanced.' }, { id: 'general', sessionId: null, createdAt: '2026-11-20T12:00:00Z', text: 'Warm up first.' }],
  analyses: [{ clipId: 'clip-1', metrics: { contact: { timestampMs: 1250, elbowAngleDegrees: 170 }, wrist: { peak: { speed: 52.5 }, average: 30 } } }],
});

describe('practice journal data rules', () => {
  it('includes session identity, date, recorded hand and actual recording duration', () => {
    const text = buildJournal(data());
    expect(text).toContain('Session ID: session-1');
    expect(text).toContain('2026-11-21T12:00:00.000Z');
    expect(text).toContain('Dominant hand: right');
    expect(text).toContain('Recording duration: 1m 5s');
  });
  it('includes linked and unassigned personal notes without losing line breaks', () => {
    const text = buildJournal(data());
    expect(text).toContain('Keep my toss steady\n    Finish balanced.');
    expect(text).toContain('Warm up first.');
    expect(text).toContain('Personal notes: 2');
  });
  it('rounds durations consistently across a minute boundary', () => {
    const fixture = data();
    const clip = fixture.clips[0];
    if (!clip) throw new Error('Missing clip fixture');
    clip.video.durationMs = 59900;
    expect(buildJournal(fixture)).toContain('Recording duration: 1m 0s');
  });
  it('exports tracked wrist speeds and estimated overhead extension', () => {
    const text = buildJournal(data());
    expect(text).toContain('30.0% of image diagonal per second');
    expect(text).toContain('52.5% of image diagonal per second');
    expect(text).toContain('170.0 degrees');
    expect(text).toContain('1.250s into video');
  });
  it('does not include video bytes, raw landmarks or pretend example coaching is personal', () => {
    const text = buildJournal(data());
    expect(text).not.toContain('BINARY_VIDEO');
    expect(text).not.toContain('RAW_LANDMARKS');
    expect(text).not.toContain("Your toss didn’t drift once");
  });
  it('keeps missing estimates unavailable instead of inventing zero or advice', () => {
    const fixture = data(); fixture.analyses = [];
    const text = buildJournal(fixture);
    expect(text).toContain('Average tracked wrist speed: Unavailable');
    expect(text).toContain('2D elbow angle at overhead reach: Unavailable');
    expect(text).not.toContain('Clean full arm extension');
  });
  it('excludes deleted sessions and their recordings from the journal summary', () => {
    const fixture = data();
    const text = buildJournal({ ...fixture, sessions: fixture.sessions.map(s => ({ ...s, deletedAt: '2026-11-21' })) });
    expect(text).toContain('Practice sessions: 0');
    expect(text).toContain('Video recordings: 0');
    expect(text).not.toContain('Clip ID: clip-1');
  });
  it('names the file using the local export date', () => {
    expect(journalFilename(new Date(2026, 10, 21, 21, 47))).toBe('serve-coach-journal-2026-11-21.md');
  });
  it('reads saved metadata and notes without including raw frames or media stores', async () => {
    const session = await store.createSession(null, { dominantHand: 'right' });
    const clip = await store.createClip(session.id, { status: 'saved', video: { durationMs: 2000, width: 1000, height: 1000 } });
    await store.putPoses(clip.id, 0, [{ t: 0, kp: null }]);
    await store.finalizeClipData(clip.id);
    await store.saveNote({ sessionId: session.id, text: 'Saved local note' });
    const snapshot = await store.getJournalData();
    expect(snapshot.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: session.id })]));
    expect(snapshot.notes).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Saved local note' })]));
    const analysis = snapshot.analyses.find((a: { clipId: string }) => a.clipId === clip.id);
    expect(analysis).toMatchObject({ clipId: clip.id, metrics: { contact: null, swingSpeed: null } });
    expect(analysis).not.toHaveProperty('frames');
    expect(snapshot).not.toHaveProperty('chunks');
    expect(snapshot).not.toHaveProperty('poses');
  });
});