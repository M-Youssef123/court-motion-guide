import { describe, expect, it } from "vitest";
import {
  bodyOrientation,
  smoothMovement,
  wristMotion,
  // @ts-expect-error plain JS module
} from "../../public/serve-coach/js/movement-analysis.js";

function frame(t: number, points: [number, number, number, number?][]) {
  const kp = Array(51).fill(0);
  for (const [i, x, y, score = 0.9] of points) kp.splice(i * 3, 3, x, y, score);
  return { t, kp };
}

describe("image-plane movement", () => {
  it("uses actual time, the selected wrist and the image aspect ratio", () => {
    const poses = [
      frame(0, [[10, 0.1, 0.5]]),
      frame(100, [[10, 0.2, 0.5]]),
      frame(150, [[10, 0.3, 0.5]]),
    ];
    const result = wristMotion(poses, { arm: "right", width: 400, height: 300 });
    expect(result.average).toBeCloseTo(16 / 0.15);
    expect(result.peak.speed).toBeCloseTo(160);
    expect(result.peak.t).toBe(150);
    expect(wristMotion(poses, { arm: "left", width: 400, height: 300 })).toBeNull();
  });

  it("does not join a missing wrist or a gap", () => {
    const poses = [
      frame(0, [[9, 0.1, 0.5]]),
      frame(60, [[9, 0.2, 0.5, 0.1]]),
      frame(120, [[9, 0.3, 0.5]]),
      frame(1000, [[9, 0.8, 0.5]]),
    ];
    expect(wristMotion(smoothMovement(poses), { arm: "left", width: 400, height: 300 })).toBeNull();
  });

  it("measures shoulder tilt and torso lean in the camera plane", () => {
    const pose = frame(0, [
      [5, 0.3, 0.2],
      [6, 0.5, 0.4],
      [11, 0.4, 0.7],
      [12, 0.6, 0.7],
    ]);
    const result = bodyOrientation(pose, 500, 500);
    expect(result.shoulderTilt).toBeCloseTo(45);
    expect(result.bodyLean).toBeCloseTo(14.036, 2);
  });
});
