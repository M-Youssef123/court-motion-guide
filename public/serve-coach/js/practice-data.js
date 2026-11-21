/* Versioned derived data over saved poses only; never changes video or runs MoveNet. */
import { analyzeServeContact, servingArm } from './contact-analysis.js';
import { buildCoachingInsights } from './coaching-insights.js';

import { bodyOrientation, smoothMovement, wristMotion } from './movement-analysis.js';

export const ANALYSIS_VERSION = 2;
const MIN_CONFIDENCE = 0.35;
const JOINTS = {
  leftElbow: [5, 7, 9], rightElbow: [6, 8, 10],
  leftShoulder: [7, 5, 11], rightShoulder: [8, 6, 12],
  leftHip: [5, 11, 13], rightHip: [6, 12, 14],
  leftKnee: [11, 13, 15], rightKnee: [12, 14, 16],
};

export function jointAngle(kp, indices, width, height) {
  if (!Array.isArray(kp) || !(width > 0) || !(height > 0)) return null;
  const points = indices.map((index) => {
    const x = kp[index * 3], y = kp[index * 3 + 1], score = kp[index * 3 + 2];
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(score) && score >= MIN_CONFIDENCE
      ? { x: x * width, y: y * height } : null;
  });
  const [a, b, c] = points;
  if (!a || !b || !c) return null;
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!length || !Number.isFinite(length)) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / length))) * 180 / Math.PI;
}

export function frameMetrics(frame, width, height) {
  const scores = [];
  for (let i = 0; i < 17; i++) {
    const score = frame.kp?.[i * 3 + 2];
    if (Number.isFinite(score) && score >= 0 && score <= 1) scores.push(score);
  }
  return {
    t: frame.t,
    trackingConfidence: scores.length ? scores.reduce((sum, score) => sum + score, 0) / 17 : null,
    trackedLandmarks: scores.filter((score) => score >= MIN_CONFIDENCE).length,
    jointAngles: Object.fromEntries(Object.entries(JOINTS).map(([name, indices]) => [name, jointAngle(frame.kp, indices, width, height)])),
  };
}

export function buildClipAnalysis(clip, frames, { arm = clip.dominantHand || clip.servingArm, offsetMs = clip.sync?.offsetMs ?? 0 } = {}) {
  const width = clip.video?.width, height = clip.video?.height;
  const strokeType = clip.strokeType || 'serve';
  const contact = strokeType === 'serve' ? analyzeServeContact(frames, { width, height, arm, offsetMs }) : null;
  const smoothed = smoothMovement(frames);
  const analysis = {
    schemaVersion: ANALYSIS_VERSION, algorithmVersion: 'movement-v2',
    clipId: clip.id, sessionId: clip.sessionId, strokeType, dominantHand: servingArm(arm),
    handSource: clip.dominantHand || clip.servingArm ? 'recorded' : servingArm(arm) ? 'replay-preference-fallback' : 'unknown',
    generatedAt: new Date().toISOString(),
    timebase: { pose: 'milliseconds since clip start', videoOffsetMs: offsetMs, offsetStatus: clip.sync?.offsetMs == null ? 'unresolved' : clip.sync.method || 'saved' },
    units: { jointAngles: 'degrees', speed: ['mph', 'km/h'], confidence: '0..1', timestamps: 'milliseconds' },
    landmarks: { store: 'poses', key: clip.id, model: clip.poses?.model || null, format: 'MoveNet-17 normalized x/y/confidence' },
    frames: frames.map((frame, i) => ({ ...frameMetrics(frame, width, height), ...bodyOrientation(smoothed[i], width, height) })),
    metrics: {
      wrist: wristMotion(smoothed, { width, height, arm: servingArm(arm) }),
      contact: contact ? { timestampMs: contact.contactTimestamp, poseTimestampMs: frames[contact.contactFrameIndex]?.t ?? null,
        frameIndex: contact.contactFrameIndex, elbowAngleDegrees: contact.elbowAngle, estimated: true } : null,
      swingSpeed: contact && contact.handSpeedMph !== null ? {
        handMph: contact.handSpeedMph, handKmh: contact.handSpeedKmh,
        racketMph: contact.estRacketSpeedMph, racketKmh: contact.estRacketSpeedKmh,
        timestampMs: contact.contactTimestamp, estimated: true,
        method: 'contact-local three-sample averaged wrist velocity', torsoReferenceMeters: 0.50, racketMultiplier: 1.75,
      } : null,
    },
    availability: contact ? 'contact-estimated' : 'contact-unavailable',
  };
  analysis.coaching = buildCoachingInsights(clip, frames, analysis);
  return analysis;
}