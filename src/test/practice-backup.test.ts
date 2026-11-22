import "fake-indexeddb/auto";
import { expect, it } from "vitest";
// @ts-expect-error static JS module
import * as store from "../../public/serve-coach/js/store.js";

it("restores analysis, notes and completed drills without duplicating records or creating a video", async () => {
  const session = await store.createSession(null, { dominantHand: "right" });
  const clip = await store.createClip(session.id, {
    status: "saved",
    video: { width: 640, height: 480, durationMs: 300, mime: "video/mp4", bytes: 13, chunks: 1 },
  });
  const frames = [0, 75, 150].map((t) => {
    const kp = Array(51).fill(0);
    kp.splice(30, 3, 0.25 + t / 1000, 0.4, 0.95);
    return { t, kp };
  });
  await store.putChunk(clip.id, 0, new TextEncoder().encode("original data"));
  await store.putPoses(clip.id, 0, frames);
  await store.saveNote({ sessionId: session.id, text: "Use a higher tripod." });
  await store.completeDrill("bend-to-reach", clip.id);
  await store.endSession(session.id);
  const analysis = await store.finalizeClipData(clip.id);
  const backup = JSON.parse(JSON.stringify(await store.exportPracticeBackup()));
  expect(backup.chunks).toBeUndefined();
  expect(await store.importPracticeBackup(backup)).toEqual({ sessions: 0, clips: 0, notes: 0 });
  expect((await store.getClipVideo(clip)).blob.size).toBe(13);
  await store.deleteSession(session.id);
  expect(await store.importPracticeBackup(backup)).toEqual({ sessions: 1, clips: 1, notes: 1 });
  expect(await store.importPracticeBackup(backup)).toEqual({ sessions: 0, clips: 0, notes: 0 });
  expect(await store.getClip(clip.id)).toMatchObject({
    restoredWithoutVideo: true,
    video: { bytes: 0, chunks: 0 },
  });
  expect(await store.getClipPoses(clip.id)).toEqual(frames);
  expect((await store.getClipAnalysis(clip.id)).metrics.wrist).toEqual(analysis.metrics.wrist);
  expect((await store.listNotes(session.id))[0].text).toBe("Use a higher tripod.");
  expect(await store.getDrillCompletion(JSON.stringify(["bend-to-reach", clip.id]))).toBeTruthy();
  expect((await store.getSession(session.id)).recordingDurationMs).toBe(300);
});

it("rejects invalid references and duplicate IDs before changing local data", async () => {
  const backup = await store.exportPracticeBackup();
  await expect(
    store.importPracticeBackup({ ...backup, sessions: [...backup.sessions, backup.sessions[0]] }),
  ).rejects.toThrow(/duplicate/);
  const broken = {
    ...backup,
    clips: backup.clips.map((clip: { sessionId: string }) => ({ ...clip, sessionId: "missing" })),
  };
  await expect(store.importPracticeBackup(broken)).rejects.toThrow(/clip metadata/);
  expect(await store.listSessions()).toHaveLength(backup.sessions.length);
});
