import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
// @ts-expect-error static JS module
import {
  detectServePhases,
  comparePhase,
  nearestPhasePose,
  serveTimingMetrics,
} from "../../public/serve-coach/js/serve-phases.js";
// @ts-expect-error static JS module
import { referencePose } from "../../public/serve-coach/js/phase-reference.js";
// @ts-expect-error static JS module
import * as store from "../../public/serve-coach/js/store.js";

function frames(left = false) {
  return [
    [800, 350, 350, 350],
    [700, 350, 350, 350],
    [600, 350, 350, 350],
    [500, 350, 350, 350],
    [450, 300, 350, 300],
    [430, 290, 350, 300],
    [350, 250, 350, 325],
    [350, 200, 350, 300],
    [350, 150, 350, 275],
    [360, 220, 355, 310],
    [370, 260, 360, 330],
    [410, 330, 380, 350],
    [450, 420, 400, 350],
    [460, 450, 410, 360],
    [470, 480, 420, 370],
  ].map((m, n) => {
    const kp = Array<number>(51).fill(0);
    const set = (i: number, x: number, y: number) => {
      kp[i * 3] = x / 1000;
      kp[i * 3 + 1] = y / 1000;
      kp[i * 3 + 2] = 0.9;
    };
    set(0, 300, 250);
    set(5, 250, 400);
    set(6, 350, 400);
    set(11, 250, 600);
    set(12, 350, 600);
    set(7, 250, 230);
    set(9, 250, 60);
    set(8, m[2] ?? 0, m[3] ?? 0);
    set(10, m[0] ?? 0, m[1] ?? 0);
    if (left)
      for (const [a, b] of [
        [5, 6],
        [7, 8],
        [9, 10],
      ]) {
        if (a === undefined || b === undefined) throw new Error("fixture");
        for (let j = 0; j < 3; j++) {
          const v = kp[a * 3 + j] ?? 0;
          kp[a * 3 + j] = kp[b * 3 + j] ?? 0;
          kp[b * 3 + j] = v;
        }
      }
    return { t: n * 100, kp };
  });
}
const clip = {
  dominantHand: "right",
  video: { width: 1000, height: 1000, durationMs: 1800 },
  sync: { offsetMs: -350 },
};
describe("saved-pose serve phases", () => {
  it("finds ordered toss, trophy and post-reach finish using the video clock", () => {
    const p = detectServePhases(frames(), clip);
    expect(p.toss).toMatchObject({
      frameIndex: 4,
      poseTimestampMs: 400,
      videoTimestampMs: 750,
      source: "automatic",
    });
    expect(p.trophy).toMatchObject({ frameIndex: 5, videoTimestampMs: 850 });
    expect(p.finish).toMatchObject({ frameIndex: 12, videoTimestampMs: 1550 });
  });
  it("measures maximum overhead extension and a contiguous trophy hold", () => {
    const poses = frames();
    const trophy = detectServePhases(poses, clip).trophy;
    const metrics = serveTimingMetrics(poses, clip.video, "right", 800, trophy);
    expect(metrics.maxOverheadElbowDegrees).toBeCloseTo(180);
    expect(metrics.trophyHoldSeconds).toBeCloseTo(0.1);
    const withGap = poses.map((pose, i) => (i === 4 ? { ...pose, kp: null } : pose));
    expect(
      serveTimingMetrics(withGap, clip.video, "right", 800, trophy).trophyHoldSeconds,
    ).toBeNull();
  });
  it("uses the recorded left arm rather than the raised non-serving arm as the stroke", () => {
    expect(
      detectServePhases(frames(true), { ...clip, dominantHand: "left" }).finish.frameIndex,
    ).toBe(12);
  });
  it("withholds automatic phases without a clear serving sequence or captured hand", () => {
    expect(detectServePhases([], clip)).toEqual({ toss: null, trophy: null, finish: null });
    expect(detectServePhases(frames(), { ...clip, dominantHand: null })).toEqual({
      toss: null,
      trophy: null,
      finish: null,
    });
  });
  it("does not infer a toss from unclear non-serving arm landmarks", () => {
    const f = frames();
    for (const frame of f) frame.kp[9 * 3 + 2] = 0.59;
    expect(detectServePhases(f, clip).toss).toBeNull();
    expect(detectServePhases(f, clip).trophy).toBeNull();
  });
  it("withholds a finish supported only by a tracking gap", () => {
    const f = frames();
    for (const frame of f) if (frame.t >= 1200) frame.t += 300;
    expect(detectServePhases(f, clip).finish).toBeNull();
  });
  it("does not apply serve heuristics to another stroke", () => {
    expect(detectServePhases(frames(), { ...clip, strokeType: "forehand" })).toEqual({
      toss: null,
      trophy: null,
      finish: null,
    });
  });
  it("only overlays nearby poses after applying the recorded offset", () => {
    const f = frames();
    expect(nearestPhasePose(f, 1150, -350)?.t).toBe(800);
    expect(nearestPhasePose(f, 2500, -350)).toBeNull();
  });
  it("compares angles against the exact original reference pose without an ideal-form score", () => {
    const r = referencePose("trophy", "right");
    const result = comparePhase(
      { kp: r },
      { dominantHand: "right", video: { width: 360, height: 440 } },
      "trophy",
    );
    expect(result.elbow.differenceDegrees).toBeCloseTo(0, 8);
    expect(result.elbow.referenceDegrees).toBeCloseTo(78.69, 1);
    expect(result.wrist).toEqual({ observed: "above", reference: "above" });
    expect(Object.keys(result).sort()).toEqual(["elbow", "wrist"]);
  });
  it("withholds differences when the relevant arm is unclear", () => {
    const f = frames()[5];
    if (!f) throw new Error("fixture");
    f.kp[10 * 3 + 2] = 0.2;
    expect(comparePhase(f, clip, "trophy")).toEqual({ elbow: null, wrist: null });
  });
  it("keeps manual frame choices attached to the clip through analysis refreshes", async () => {
    const s = await store.createSession(null, { playerHand: "R" });
    const c = await store.createClip(s.id, { status: "saved", video: clip.video, sync: clip.sync });
    await store.putPoses(c.id, 0, frames());
    await store.updateClip(c.id, {
      phaseSelections: { finish: { version: 1, videoTimestampMs: 1400, source: "manual" } },
    });
    await store.finalizeClipData(c.id);
    expect((await store.getClip(c.id)).phaseSelections.finish).toMatchObject({
      version: 1,
      videoTimestampMs: 1400,
      source: "manual",
    });
  });
});
