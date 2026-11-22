/* Image-plane measurements over timestamped MoveNet frames, shared across strokes. */
const MAX_GAP_MS = 180;
const MIN_SCORE = 0.35;
const validStep = (dt) => dt >= 8 && dt <= MAX_GAP_MS;

function point(frame, index, minScore = MIN_SCORE) {
  const [x, y, score] = frame?.kp?.slice(index * 3, index * 3 + 3) || [];
  if (![x, y, score].every(Number.isFinite) || score < minScore || score > 1 ||
    x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y, score };
}

/** Smooth within contiguous observations, preserving timestamps, frame indices and gaps. */
export function smoothMovement(frames) {
  return frames.map((frame, i) => {
    if (!frame.kp) return frame;
    const before = frames[i - 1], after = frames[i + 1];
    if (!validStep(frame.t - before?.t) || !validStep(after?.t - frame.t)) return frame;
    const weight = (frame.t - before.t) / (after.t - before.t);
    const kp = [...frame.kp];
    for (let joint = 0; joint < 17; joint++) {
      const a = point(before, joint), b = point(frame, joint), c = point(after, joint);
      if (!a || !b || !c) continue;
      kp[joint * 3] = (b.x + a.x * (1 - weight) + c.x * weight) / 2;
      kp[joint * 3 + 1] = (b.y + a.y * (1 - weight) + c.y * weight) / 2;
    }
    return { ...frame, kp };
  });
}

export function bodyOrientation(frame, width, height, arm) {
  const [left, right, leftHip, rightHip] = [5, 6, 11, 12].map((i) => point(frame, i));
  const result = { shoulderTilt: null, bodyLean: null, armExtension: null };
  if (width > 0 && height > 0 && ['left', 'right'].includes(arm)) {
    const [shoulder, elbow, wrist] = (arm === 'left' ? [5, 7, 9] : [6, 8, 10]).map(i => point(frame, i));
    const distance = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
    if (shoulder && elbow && wrist) {
      const length = distance(shoulder, elbow) + distance(elbow, wrist);
      if (length > 0) result.armExtension = Math.min(1, distance(shoulder, wrist) / length);
    }
  }
  if (!left || !right || !(width > 0 && height > 0)) return result;
  const dx = Math.abs((left.x - right.x) * width);
  const dy = Math.abs((left.y - right.y) * height);
  if (dx || dy) result.shoulderTilt = Math.atan2(dy, dx) * 180 / Math.PI;
  if (!leftHip || !rightHip) return result;
  const x = Math.abs((left.x + right.x - leftHip.x - rightHip.x) * width);
  const y = (leftHip.y + rightHip.y - left.y - right.y) * height;
  if (y > 0) result.bodyLean = Math.atan2(x, y) * 180 / Math.PI;
  return result;
}

export function wristMotion(frames, { width, height, arm } = {}) {
  if (!(width > 0 && height > 0) || !['left', 'right'].includes(arm)) return null;
  const diagonal = Math.hypot(width, height);
  const trajectory = [];
  let previous = null, peak = null, distance = 0, seconds = 0, segments = 0;
  for (const frame of frames) {
    const wrist = point(frame, arm === 'left' ? 9 : 10, 0.6);
    if (!wrist || !Number.isFinite(frame.t)) {
      previous = null;
      continue;
    }
    const dt = frame.t - previous?.t;
    const connected = validStep(dt);
    const sample = { t: frame.t, x: wrist.x, y: wrist.y, connected };
    trajectory.push(sample);
    if (connected) {
      const traveled = Math.hypot((sample.x - previous.x) * width, (sample.y - previous.y) * height) * 100 / diagonal;
      const speed = traveled / (dt / 1000);
      sample.speed = speed;
      distance += traveled;
      seconds += dt / 1000;
      segments++;
      if (!peak || speed > peak.speed) peak = { ...sample, speed };
    }
    previous = sample;
  }
  if (segments < 2) return null;
  return { trajectory, peak, average: distance / seconds, trackedSeconds: seconds, segments };
}

export function jointAngle(kp, indices, width, height) {
  if (!Array.isArray(kp) || !(width > 0) || !(height > 0)) return null;
  const points = indices.map((index) => {
    const x = kp[index * 3], y = kp[index * 3 + 1], score = kp[index * 3 + 2];
    return Number.isFinite(x) && x >= 0 && x <= 1 && Number.isFinite(y) && y >= 0 && y <= 1
      && Number.isFinite(score) && score >= MIN_SCORE && score <= 1
      ? { x: x * width, y: y * height } : null;
  });
  const [a, b, c] = points;
  if (!a || !b || !c) return null;
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!length || !Number.isFinite(length)) return null;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / length))) * 180 / Math.PI;
}
