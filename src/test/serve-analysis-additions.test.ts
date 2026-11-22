import { describe, expect, it } from "vitest";
// @ts-expect-error static JS module
import { coachTopic, topicAnswer } from "../../public/serve-coach/js/coach-qa.js";
describe("free-text coach", () => {
  it("matches specific questions before generic improvement language", () => {
    expect(coachTopic("How can I improve my pronation?")).toBe("pronation");
    expect(coachTopic("Am I rushing through the trophy?")).toBe("trophy");
    expect(coachTopic("Why is my serve going into the net?")).toBe("net");
    expect(coachTopic("Should I change my shoes?")).toBeNull();
  });

  it("grounds tempo guidance in a measurement when available and identifies missing evidence", () => {
    for (const key of ["net", "pronation", "trophy", "wrist", "toss"]) {
      const a = topicAnswer(key);
      expect(a?.causes.length).toBeGreaterThan(0);
      expect(a?.fix.length).toBeGreaterThan(0);
      expect(JSON.stringify(a)).not.toMatch(/insufficient|cannot establish/i);
    }
  });
});
