/* Presentation only: never convert image-diagonal velocity into physical speed. */
export function replayWristSummary(metrics) {
  const mph = metrics?.swingSpeed?.handMph;
  if (Number.isFinite(mph) && mph >= 0 && mph <= 65) {
    return { kind: "estimated-speed", mph };
  }
  const wrist = metrics?.wrist;
  const peak = wrist?.peak?.speed;
  const average = wrist?.average;
  if (!Number.isFinite(peak) || !Number.isFinite(average) || peak < 0 || average < 0) {
    return { kind: "unavailable" };
  }
  // These bands compare movement only within this clip, not player ability or acceleration.
  const ratio = average > 0 ? peak / average : peak === 0 ? 1 : null;
  if (ratio === null || ratio < 1) return { kind: "unavailable" };
  return {
    kind: "relative-motion",
    band: ratio >= 2 ? "much-faster" : ratio >= 1.25 ? "faster" : "near-average",
  };
}