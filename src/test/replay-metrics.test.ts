import { describe, expect, it } from "vitest";
// @ts-expect-error static JS module
import { replayWristSummary } from "../../public/serve-coach/js/replay-metrics.js";
// @ts-expect-error static JS module
import { wristTrailSamples, drawSwingArc } from "../../public/serve-coach/js/swing-arc.js";

describe("replay movement presentation", () => {
  it("uses a supported torso-scaled mph estimate without converting normalized velocity", () => {
    expect(replayWristSummary({ swingSpeed: { handMph: 42 }, wrist: { peak: { speed: 175.1 }, average: 82.4 } }))
      .toEqual({ kind: "estimated-speed", mph: 42 });
  });
  it("compares normalized movement only with the same clip's average", () => {
    expect(replayWristSummary({ wrist: { peak: { speed: 175.1 }, average: 82.4 } }))
      .toEqual({ kind: "relative-motion", band: "much-faster" });
    expect(replayWristSummary({ wrist: { peak: { speed: 120 }, average: 100 } }).band).toBe("near-average");
    expect(replayWristSummary({ wrist: { peak: { speed: 150 }, average: 100 } }).band).toBe("faster");
  });
  it("withholds mph for invalid estimates and never fabricates speed from wrist coordinates", () => {
    for (const mph of [NaN, Infinity, -1, 66, null]) {
      expect(replayWristSummary({ swingSpeed: { handMph: mph } }).kind).toBe("unavailable");
    }
    expect(replayWristSummary({}).kind).toBe("unavailable");
    expect(replayWristSummary({ wrist: { peak: { speed: 1 }, average: 0 } }).kind).toBe("unavailable");
  });
});

describe("300 ms wrist trail", () => {
  it("includes exactly the preceding 300 ms and no future frames", () => {
    const trajectory = [0, 199, 200, 300, 500, 501].map(t => ({ t }));
    expect(wristTrailSamples(trajectory, 500).map((p: { t: number }) => p.t)).toEqual([200, 300, 500]);
    expect(wristTrailSamples(trajectory, NaN)).toEqual([]);
  });
  it("never connects a tracking gap or draws future movement", () => {
    const lines: number[][] = [];
    const ctx = {
      save() {}, restore() {}, setTransform() {}, beginPath() {}, moveTo() {}, stroke() {},
      lineTo(x: number, y: number) { lines.push([x, y]); },
    };
    drawSwingArc({ ctx, dpr: 1, mapping: { sx: 1, sy: 1, ox: 0, oy: 0 }, video: { videoWidth: 100, videoHeight: 100 } },
      [
        { t: 0, x: 0, y: 0, connected: false },
        { t: 100, x: .1, y: .1, speed: 1, connected: true },
        { t: 200, x: .2, y: .2, speed: 1, connected: false },
        { t: 400, x: .4, y: .4, speed: 1, connected: true },
      ], { poseMs: 300, peak: { speed: 1 } });
    expect(lines).toEqual([[10, 10]]);
  });
});
