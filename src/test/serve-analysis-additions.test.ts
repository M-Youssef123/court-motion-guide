import { describe, expect, it } from "vitest";
// @ts-expect-error static JS module
import { coachTopic, topicAdvice } from "../../public/serve-coach/js/coach-qa.js";
// @ts-expect-error static JS module
import { selectSwing, selectTrackedSwing } from "../../public/serve-coach/js/swing-arc.js";

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

  it("marks a continuous arc as partial when phase boundaries are missing", () => {
    expect(selectTrackedSwing({ trajectory }, 110)).toMatchObject({
      partial: true,
      apex: { t: 110 },
    });
  });

  it("rejects a full ribbon when wrist tracking breaks around the apex", () => {
    const broken = trajectory.map((sample, i) =>
      i === 2 ? { ...sample, connected: false } : sample,
    );
    expect(selectSwing({ trajectory: broken }, 0, 110, 230)).toBeNull();
  });
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
