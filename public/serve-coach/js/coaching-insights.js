/* Conservative, reproducible observations from saved poses. No remote AI or ball inference. */
import { servingArm } from './contact-analysis.js';

export const COACHING_VERSION = 1;
export function buildCoachingInsights(clip, poses, analysis) {
  const empty = (reason) => ({ version: COACHING_VERSION, status: 'insufficient', reason,
    positive: null, improvement: null, recommendation: null });
  const arm = servingArm(clip.dominantHand || clip.servingArm);
  if (!arm || analysis.handSource !== 'recorded') return empty('The serving hand was not recorded with this clip.');
  if ((clip.strokeType || 'serve') !== 'serve') return empty('Coaching for this stroke is not available yet.');
  const contact = analysis.metrics?.contact;
  if (!contact || !Number.isInteger(contact.frameIndex)) return empty('No reliable overhead serving sequence was found.');
  const i = contact.frameIndex, indices = arm === 'right' ? [6, 8, 10] : [5, 7, 9];
  const joint = arm === 'right' ? 'rightElbow' : 'leftElbow';
  const width = clip.video?.width, height = clip.video?.height;
  if (!(width > 0) || !(height > 0)) return empty('The recorded picture dimensions are unavailable.');
  const clear = (frame) => Number.isFinite(frame?.t) && [...indices, 0, 5, 6, 11, 12].every(n => {
    const x = frame.kp?.[n * 3], y = frame.kp?.[n * 3 + 1], score = frame.kp?.[n * 3 + 2];
    return Number.isFinite(x) && x >= 0 && x <= 1 && Number.isFinite(y) && y >= 0 && y <= 1
      && Number.isFinite(score) && score >= 0.6 && score <= 1;
  });
  // Five clear neighboring frames, no duplicates or tracking gaps around the apex.
  const local = poses.slice(i - 2, i + 3);
  if (i < 2 || local.length !== 5 || !local.every(clear)
      || local.some((f, n) => n > 0 && (f.t <= local[n - 1].t || f.t - local[n - 1].t > 200))) {
    return empty('The serving arm, head or torso was not tracked clearly enough around peak reach.');
  }
  const angle = analysis.frames?.[i]?.jointAngles?.[joint];
  if (!Number.isFinite(angle) || angle <= 135 || angle > 180) return empty('The serving elbow angle is unclear.');
  const wrist = indices[2];
  if (!(poses[i].kp[wrist * 3 + 1] < poses[i].kp[1])
      || !(local[0].kp[wrist * 3 + 1] > local[1].kp[wrist * 3 + 1]
        && local[1].kp[wrist * 3 + 1] > local[2].kp[wrist * 3 + 1])) {
    return empty('A clear upward wrist movement into overhead reach was not found.');
  }
  let preparation = -1;
  for (let n = i - 1; n >= 0 && poses[i].t - poses[n].t <= 500; n--) {
    if (!clear(poses[n]) || poses[n + 1].t - poses[n].t > 200 || poses[n + 1].t <= poses[n].t) break;
    const a = analysis.frames?.[n]?.jointAngles?.[joint];
    if (Number.isFinite(a) && a < 115 && angle - a >= 25) { preparation = n; break; }
  }
  if (preparation < 0) return empty('The bent-arm preparation was not tracked clearly enough.');
  const offset = analysis.timebase?.videoOffsetMs;
  const timestampMs = Number.isFinite(offset) && analysis.timebase?.offsetStatus !== 'unresolved'
    ? poses[i].t - offset : null;
  const evidence = { clipId: clip.id, frameIndex: i, poseTimestampMs: poses[i].t,
    timestampMs: timestampMs >= 0 && timestampMs <= clip.video?.durationMs ? timestampMs : null,
    elbowAngleDegrees: angle, preparationFrameIndex: preparation,
    minLandmarkConfidence: Math.min(...local.flatMap(f => [...indices, 0, 5, 6, 11, 12].map(n => f.kp[n * 3 + 2]))) };
  const item = (text) => ({ text, evidence });
  return { version: COACHING_VERSION, status: 'supported', reason: null,
    positive: item(`Your ${arm} serving arm opened from a bent preparation into overhead reach, with the wrist moving upward across three tracked frames.`),
    improvement: angle < 165 ? item(`At estimated peak reach, your ${arm} elbow appeared partly bent (${angle.toFixed(0)}° in the camera view). Review whether you can reach more comfortably upward.`) : null,
    recommendation: item(angle < 165
      ? 'Try a few slow shadow serves, reaching comfortably upward without forcing or locking the elbow. Compare your arm position with this recorded moment.'
      : 'Repeat a few relaxed shadow serves to maintain this bent-to-extended arm sequence, then compare the same phase in your next recording.'),
  };
}