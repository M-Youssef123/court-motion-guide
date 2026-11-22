import { describe, expect, it } from "vitest";
import {
  analyzeServeContact,
  extensionInsight,
  resolveServingArm,
  // @ts-expect-error static app uses plain JS modules
} from "../../public/serve-coach/js/contact-analysis.js";

const size = { width: 1000, height: 1000, arm: "right" };
function serve(arm = "right") {
  const motion = [
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
    [450, 400, 400, 350],
  ];
  return motion.map((m, n) => {
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
    set(10, m[0] ?? 0, m[1] ?? 0);
    set(8, m[2] ?? 0, m[3] ?? 0);
    if (arm === "left") {
      for (const [a, b] of [
        [7, 8],
        [9, 10],
      ]) {
        if (a === undefined || b === undefined) throw new Error("Bad fixture");
        const x = kp[a * 3] ?? 0,
          y = kp[a * 3 + 1] ?? 0;
        kp[a * 3] = (kp[b * 3] ?? 0) - 0.1;
        kp[a * 3 + 1] = kp[b * 3 + 1] ?? 0;
        kp[b * 3] = x + 0.1;
        kp[b * 3 + 1] = y;
      }
    }
    return { t: n * 100, kp };
  });
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture");
  return value;
}
function angleAt(frames: ReturnType<typeof serve>, index: number, angle: number) {
  const f = required(frames[index]);
  f.kp[8 * 3] = 0.35;
  f.kp[8 * 3 + 1] = 0.275;
  f.kp[10 * 3] = (350 + 125 * Math.sin((angle * Math.PI) / 180)) / 1000;
  f.kp[10 * 3 + 1] = (275 + 125 * Math.cos((angle * Math.PI) / 180)) / 1000;
}

describe("selected serving arm contact analysis", () => {
  it("uses saved clip selection before session or current preference", () => {
    expect(resolveServingArm({ servingArm: "left" }, { hand: "R" }, { hand: "R" })).toBe("left");
    expect(resolveServingArm({}, { hand: "L" }, { hand: "R" })).toBe("left");
    expect(resolveServingArm({}, {}, { hand: "R" })).toBe("right");
    expect(resolveServingArm({}, {}, {})).toBeNull();
  });
  it("isolates either selected arm and ignores the higher tossing wrist", () => {
    for (const arm of ["right", "left"]) {
      const result = analyzeServeContact(serve(arm), { ...size, arm });
      expect(result?.contactFrameIndex).toBe(8);
      expect(result?.contactTimestamp).toBe(800);
      expect(result?.arm).toBe(arm);
    }
    expect(analyzeServeContact(serve(), { ...size, arm: "left" })).toBeNull();
  });
  it("does not require the non-serving elbow or wrist to be tracked", () => {
    const frames = serve();
    for (const f of frames) {
      f.kp[7 * 3 + 2] = 0;
      f.kp[9 * 3 + 2] = 0;
    }
    expect(analyzeServeContact(frames, size)?.contactFrameIndex).toBe(8);
  });
  it("requires a trophy angle strictly below 115 degrees", () => {
    const frames = serve();
    for (const i of [0, 1, 2, 3, 4, 5]) angleAt(frames, i, 115.01);
    expect(analyzeServeContact(frames, size)).toBeNull();
    angleAt(frames, 5, 114.99);
    expect(analyzeServeContact(frames, size)?.contactFrameIndex).toBe(8);
  });
  it("requires trophy within the preceding 0.75 seconds", () => {
    const frames = serve();
    for (let i = 0; i <= 7; i++) angleAt(frames, i, 115.01);
    angleAt(frames, 1, 114.99); // 700 ms before contact
    expect(analyzeServeContact(frames, size)?.contactFrameIndex).toBe(8);
    angleAt(frames, 1, 115.01);
    angleAt(frames, 0, 114.99); // 800 ms before contact
    expect(analyzeServeContact(frames, size)).toBeNull();
  });
  it("requires extension strictly above 135 degrees and wrist above the serving shoulder", () => {
    const frames = serve();
    // Keep the tested frame the global wrist apex.
    for (const i of [6, 7, 9]) required(frames[i]).kp[10 * 3 + 1] = 0.29;
    angleAt(frames, 8, 134.99);
    expect(analyzeServeContact(frames, size)).toBeNull();
    angleAt(frames, 8, 135.01);
    expect(analyzeServeContact(frames, size)?.contactFrameIndex).toBe(8);
    required(frames[8]).kp[1] = 0.1; // nose above the wrist no longer blocks side-on footage
    expect(analyzeServeContact(frames, size)?.contactFrameIndex).toBe(8);
  });
  it("uses the contact-frame torso scale of 0.50 / 200", () => {
    const frames = serve();
    for (const [i, f] of frames.entries())
      if (i !== 8) {
        f.kp[11 * 3 + 1] = 0.8;
        f.kp[12 * 3 + 1] = 0.8;
      }
    const result = analyzeServeContact(frames, size);
    expect(result?.metersPerPixel).toBe(0.0025);
    const expected = ((50 + 50 + Math.hypot(10, 70)) * 0.0025) / 0.1 / 3;
    expect(result?.handSpeedMph).toBeCloseTo(expected * 2.237, 8);
    expect(result?.handSpeedKmh).toBeCloseTo(expected * 3.6, 8);
    expect(result).not.toHaveProperty("estRacketSpeedMph");
  });
  it("does not use fast preparation outside the ±3-frame impact window", () => {
    const frames = serve();
    const baseline = analyzeServeContact(frames, size);
    required(frames[0]).kp[10 * 3] = 0.05;
    required(frames[1]).kp[10 * 3] = 0.95;
    expect(analyzeServeContact(frames, size)?.handSpeedMph).toBe(baseline?.handSpeedMph);
  });
  it("uses real frame times and restores pixel aspect ratio", () => {
    const baseline = analyzeServeContact(serve(), size);
    const faster = serve().map((f) => ({ ...f, t: f.t / 2 }));
    expect(analyzeServeContact(faster, size)?.handSpeedMph).toBeCloseTo(
      baseline.handSpeedMph * 2,
      8,
    );
    const wide = serve().map((f) => ({
      ...f,
      kp: f.kp.map((v, i) =>
        i % 3 === 0 ? (v * 1000) / 1920 : i % 3 === 1 ? (v * 1000) / 1080 : v,
      ),
    }));
    expect(
      analyzeServeContact(wide, { ...size, width: 1920, height: 1080 })?.handSpeedMph,
    ).toBeCloseTo(baseline.handSpeedMph, 8);
  });
  it("withholds contact on missing serving-arm tracking or gaps", () => {
    for (const index of [6, 8]) {
      const frames = serve();
      required(frames[8]).kp[index * 3 + 2] = 0.349;
      expect(analyzeServeContact(frames, size)).toBeNull();
    }
    expect(
      analyzeServeContact(
        serve().map((f) => ({ ...f, t: f.t * 3 })),
        size,
      ),
    ).toBeNull();
    expect(analyzeServeContact([], size)).toBeNull();
    expect(analyzeServeContact(serve(), { ...size, arm: null })).toBeNull();
  });
  it("bridges a single blurred wrist sample beside the apex", () => {
    const frames = serve();
    required(frames[7]).kp[10 * 3 + 2] = 0.1;
    expect(analyzeServeContact(frames, size)?.contactFrameIndex).toBe(8);
    required(frames[6]).kp[10 * 3 + 2] = 0.1;
    expect(analyzeServeContact(frames, size)).toBeNull();
  });
  it("retains contact but withholds speed when torso scale is unavailable", () => {
    const frames = serve();
    required(frames[8]).kp[11 * 3 + 2] = 0;
    const result = analyzeServeContact(frames, size);
    expect(result?.contactTimestamp).toBe(800);
    expect(result?.handSpeedMph).toBeNull();
  });
  it("converts the contact pose clock to the video clock", () => {
    expect(analyzeServeContact(serve(), { ...size, offsetMs: -350 })?.contactTimestamp).toBe(1150);
    expect(analyzeServeContact(serve(), { ...size, offsetMs: 801 })).toBeNull();
  });
  it("gives clean full-extension feedback at 165 degrees and above", () => {
    expect(extensionInsight(165)).toBe("Clean full arm extension at contact!");
    expect(extensionInsight(180)).toBe("Clean full arm extension at contact!");
  });
  it("gives reaching-higher feedback from 145 to below 165 degrees", () => {
    expect(extensionInsight(145)).toBe(
      "Solid contact, but reaching higher for full extension will unlock extra power.",
    );
    expect(extensionInsight(164.99)).toBe(
      "Solid contact, but reaching higher for full extension will unlock extra power.",
    );
  });
  it("gives bent-arm feedback below 145 degrees", () => {
    expect(extensionInsight(144.99)).toBe(
      "Bent-arm contact detected. Toss higher and hit at peak reach to clear the net.",
    );
  });
});
