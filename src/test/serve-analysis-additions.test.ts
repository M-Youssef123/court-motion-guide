import { describe, expect, it } from "vitest";
import {
  ballCandidates,
  possibleContact,
  traceBallToss,
  // @ts-expect-error static JS module
} from "../../public/serve-coach/js/ball-toss.js";
// @ts-expect-error static JS module
import { coachTopic, topicAdvice } from "../../public/serve-coach/js/coach-qa.js";
// @ts-expect-error static JS module
import { selectSwing } from "../../public/serve-coach/js/swing-arc.js";

describe("velocity-coloured swing", () => {
  const trajectory = [
    { t: 0, x: 0.4, y: 0.6, connected: false },
    { t: 60, x: 0.4, y: 0.5, speed: 1, connected: true },
    { t: 110, x: 0.5, y: 0.2, speed: 8, connected: true },
    { t: 140, x: 0.6, y: 0.28, speed: 12, connected: true },
    { t: 230, x: 0.65, y: 0.7, speed: 6, connected: true },
  ];
  it("keeps distinct highest and maximum speed points inside the detected swing", () => {
    const result = selectSwing({ trajectory }, 0, 110, 230);
    expect(result.apex.t).toBe(110);
    expect(result.peak.t).toBe(140);
  });

  it("rejects a full ribbon when wrist tracking breaks around the apex", () => {
    const broken = trajectory.map((sample, i) =>
      i === 2 ? { ...sample, connected: false } : sample,
    );
    expect(selectSwing({ trajectory: broken }, 0, 110, 230)).toBeNull();
  });
});

describe("local toss tracking", () => {
  it("finds a small fluorescent contour and ignores a large stationary region", () => {
    const width = 40,
      height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    const pixel = (x: number, y: number) => data.set([185, 240, 32, 255], (y * width + x) * 4);
    for (let x = 12; x < 15; x++) for (let y = 10; y < 13; y++) pixel(x, y);
    for (let x = 23; x < 35; x++) for (let y = 24; y < 34; y++) pixel(x, y);
    const result = ballCandidates(
      { data, width, height },
      { left: 0, right: 1, top: 0, bottom: 1 },
    );
    expect(result).toEqual([{ x: 13.5 / 40, y: 11.5 / 40 }]);
  });

  it("follows a toss launched near the non-serving hand through an observed ascent and descent", () => {
    const samples = [0.54, 0.48, 0.43, 0.4, 0.39, 0.402, 0.42, 0.45].map((y, i) => ({
      t: i * 42,
      candidates: [
        { x: 0.45 + i * 0.005, y },
        { x: 0.53, y: 0.46 },
      ],
    }));
    const release = { x: 0.44, y: 0.56, t: 0 };
    const result = traceBallToss(samples, release, 1);
    expect(result.apex.t).toBe(168);
    expect(result.path).toHaveLength(8);
    expect(traceBallToss(samples.slice(0, 5), release, 1)).toBeNull();
    expect(traceBallToss(samples, { x: 0.9, y: 0.9, t: 0 }, 1)).toBeNull();
  });
});

it("offers a possible contact cue only with a distinct visible departure near overhead reach", () => {
  const path = [
    { x: 0.4, y: 0.34, t: 42 },
    { x: 0.41, y: 0.36, t: 84 },
    { x: 0.42, y: 0.39, t: 126 },
  ];
  const track = { apex: path[0], path };
  const reach = { x: 0.4, y: 0.38, t: 125 };
  const departure = [
    { t: 168, candidates: [{ x: 0.5, y: 0.34 }] },
    { t: 210, candidates: [{ x: 0.58, y: 0.29 }] },
  ];
  expect(possibleContact(departure, track, reach, 1)).toMatchObject({ t: 126 });
  expect(possibleContact(departure.slice(0, 1), track, reach, 1)).toBeNull();
  expect(
    possibleContact([{ t: 168, candidates: [{ x: 0.43, y: 0.42 }] }], track, reach, 1),
  ).toBeNull();
  expect(
    possibleContact([{ t: 168, candidates: [{ x: 0.5, y: 0.34 }] }], track, null, 1),
  ).toBeNull();
});

describe("free-text coach", () => {
  it("matches specific questions before generic improvement language", () => {
    expect(coachTopic("How can I improve my pronation?")).toBe("pronation");
    expect(coachTopic("Am I rushing through the trophy?")).toBe("trophy");
    expect(coachTopic("Why is my serve going into the net?")).toBe("net");
    expect(coachTopic("Should I change my shoes?")).toBeNull();
  });

  it("grounds tempo guidance in a measurement when available and identifies missing evidence", () => {
    expect(topicAdvice("trophy", null, 0.32).evidence).toContain("0.32 s");
    expect(topicAdvice("trophy", null, null).evidence).toContain("insufficient");
    expect(topicAdvice("net", null).evidence).toContain("cannot establish");
  });
});
