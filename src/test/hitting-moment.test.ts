import { describe, expect, it } from "vitest";
// @ts-expect-error static app uses plain JS modules
import { findHittingMoment, analyzeSwingSpeed } from "../../public/serve-coach/js/features.js";

const size = { width: 1000, height: 1000 };
function serveFrames() {
  const motion = [
    [800, 350, 350, 350],
    [550, 350, 350, 350],
    [450, 300, 350, 300],
    [350, 220, 350, 310],
    [350, 150, 350, 275],
    [370, 260, 360, 330],
    [450, 400, 400, 350],
    [500, 450, 410, 350],
  ];
  return motion.map((pose, n) => {
    const kp = Array<number>(51).fill(0);
    const set = (i: number, x: number, y: number) => {
      kp[i * 3] = x / 1000;
      kp[i * 3 + 1] = y / 1000;
      kp[i * 3 + 2] = 0.9;
    };
    set(5, 250, 400);
    set(6, 350, 400);
    set(11, 250, 600);
    set(12, 350, 600);
    // Toss arm reaches higher, but remains straight (no racket preparation).
    set(7, 250, 230);
    set(9, 250, 60);
    set(10, pose[0] ?? 0, pose[1] ?? 0);
    set(8, pose[2] ?? 0, pose[3] ?? 0);
    return { t: n * 100, kp };
  });
}

describe("hitting-phase replay target", () => {
  it("targets overhead hitting extension at 400 ms, not a faster preparation movement", () => {
    const frames = serveFrames();
    expect(findHittingMoment(frames, size)).toEqual({ timestamp: 400, arm: "right" });
    expect(analyzeSwingSpeed(frames, size)?.peakTimestamp).not.toBe(400);
  });
  it("selects the hitting arm rather than the higher-reaching toss arm", () => {
    expect(analyzeSwingSpeed(serveFrames(), size)?.dominantArm).toBe("right");
  });
  it("withholds the target for a toss with no bent-arm preparation", () => {
    const frames = serveFrames();
    for (const f of frames) f.kp[10 * 3 + 2] = 0;
    expect(findHittingMoment(frames, size)).toBeNull();
  });
  it("requires follow-through rather than assuming contact at any raised arm", () => {
    expect(findHittingMoment(serveFrames().slice(0, 5), size)).toBeNull();
  });
  it("does not bridge missing tracking or gaps between preparation and extension", () => {
    const frames = serveFrames();
    const hit = frames[3];
    if (!hit) throw new Error("Missing fixture");
    hit.kp[8 * 3 + 2] = 0.349;
    expect(findHittingMoment(frames, size)).toBeNull();
    expect(
      findHittingMoment(
        serveFrames().map((f) => ({ ...f, t: f.t * 3 })),
        size,
      ),
    ).toBeNull();
  });
  it("applies the saved pose/video offset to the hitting moment", () => {
    expect(findHittingMoment(serveFrames(), { ...size, offsetMs: -350 })?.timestamp).toBe(750);
    expect(findHittingMoment(serveFrames(), { ...size, offsetMs: 500 })).toBeNull();
  });
  it("withholds ambiguous opposite-arm hitting motions", () => {
    const frames = serveFrames();
    for (const f of frames) {
      for (const [left, right] of [
        [7, 8],
        [9, 10],
      ]) {
        if (left === undefined || right === undefined) throw new Error("Missing fixture");
        f.kp[left * 3] = (f.kp[right * 3] ?? 0) - 0.1;
        f.kp[left * 3 + 1] = f.kp[right * 3 + 1] ?? 0;
      }
    }
    expect(findHittingMoment(frames, size)).toBeNull();
  });
});
