/* Original Serve Coach diagrams, not footage or a measured ideal technique. */
export const REFERENCE_WIDTH = 360,
  REFERENCE_HEIGHT = 440;
const base = {
  0: [180, 112],
  1: [174, 108],
  2: [186, 108],
  3: [166, 111],
  4: [194, 111],
  5: [158, 158],
  6: [202, 158],
  11: [163, 262],
  12: [197, 262],
  13: [146, 326],
  14: [219, 326],
  15: [132, 395],
  16: [238, 395],
};
const arms = {
  toss: { 7: [150, 102], 9: [142, 46], 8: [230, 210], 10: [232, 266] },
  trophy: { 7: [149, 106], 9: [140, 54], 8: [247, 158], 10: [237, 108] },
  finish: { 7: [133, 224], 9: [131, 280], 8: [185, 218], 10: [147, 278] },
};
export function referencePose(phase, arm = "right") {
  if (!arms[phase]) return null;
  const points = { ...base, ...arms[phase] },
    kp = Array(51).fill(0);
  for (let i = 0; i < 17; i++) {
    const source = arm === "left" && i > 0 ? (i % 2 ? i + 1 : i - 1) : i;
    const p = points[source];
    kp[i * 3] = (arm === "left" ? REFERENCE_WIDTH - p[0] : p[0]) / REFERENCE_WIDTH;
    kp[i * 3 + 1] = p[1] / REFERENCE_HEIGHT;
    kp[i * 3 + 2] = 1;
  }
  return kp;
}
