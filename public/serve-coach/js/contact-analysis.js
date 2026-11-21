/* Saved MoveNet poses only. Contact is a pose-based estimate, not detected ball impact. */
const ARMS = { right: { shoulder: 6, elbow: 8, wrist: 10 }, left: { shoulder: 5, elbow: 7, wrist: 9 } };
const MIN_CONFIDENCE = 0.35;
const MAX_GAP_MS = 250;

export function servingArm(value) {
  return value === 'R' || value === 'right' ? 'right' : value === 'L' || value === 'left' ? 'left' : null;
}

// Prefer recorded selection; never infer the serving arm from the tossing arm.
export function resolveServingArm(clip, session, profile) {
  return servingArm(clip?.servingArm) || servingArm(clip?.dominantHand)
    || servingArm(session?.dominantHand) || servingArm(session?.playerHand) || servingArm(session?.hand) || servingArm(profile?.hand);
}

export function extensionInsight(angle) {
  if (!Number.isFinite(angle) || angle < 0 || angle > 180) return null;
  if (angle >= 165) return 'Clean full arm extension at contact!';
  if (angle >= 145) return 'Solid contact, but reaching higher for full extension will unlock extra power.';
  return 'Bent-arm contact detected. Toss higher and hit at peak reach to clear the net.';
}

function point(frame, index, width, height) {
  const kp = frame?.kp;
  if (!kp || !Number.isFinite(frame.t) || !Number.isFinite(kp[index * 3 + 2]) || kp[index * 3 + 2] < MIN_CONFIDENCE) return null;
  const x = kp[index * 3] * width, y = kp[index * 3 + 1] * height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function armPose(frame, arm, width, height) {
  const indices = ARMS[arm];
  const shoulder = point(frame, indices.shoulder, width, height);
  const elbow = point(frame, indices.elbow, width, height);
  const wrist = point(frame, indices.wrist, width, height);
  if (!shoulder || !elbow || !wrist) return null;
  const ux = shoulder.x - elbow.x, uy = shoulder.y - elbow.y;
  const vx = wrist.x - elbow.x, vy = wrist.y - elbow.y;
  const lengths = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!lengths) return null;
  const angle = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / lengths))) * 180 / Math.PI;
  return { t: frame.t, wrist, angle };
}

/** Trophy <115° within preceding 500 ms; selected wrist apex above nose; extension >135°.
 * Velocity uses the contact-frame 0.50 m torso scale and a centered three-sample
 * moving average nearest contact, restricted to ±3 saved frames. No global speed peak.
 */
export function analyzeServeContact(frames, { width, height, arm, offsetMs = 0 }) {
  arm = servingArm(arm);
  if (!arm || !Array.isArray(frames) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(offsetMs)) return null;
  const poses = frames.map(f => armPose(f, arm, width, height));
  let contactFrameIndex = -1;
  // The maximum tracked vertical reach must itself satisfy the contact criteria.
  let apexY = Infinity;
  frames.forEach((f, i) => {
    const wrist = point(f, ARMS[arm].wrist, width, height);
    if (wrist && wrist.y < apexY) { contactFrameIndex = i; apexY = wrist.y; }
  });
  const hit = poses[contactFrameIndex];
  const frame = frames[contactFrameIndex];
  if (!hit || !frame || hit.angle <= 135) return null;
  const nose = point(frame, 0, width, height);
  if (!nose || hit.wrist.y >= nose.y) return null;
  // Missing selected-wrist tracking adjacent to the apex makes its timing uncertain.
  if (contactFrameIndex > 0 && !point(frames[contactFrameIndex - 1], ARMS[arm].wrist, width, height)) return null;
  if (contactFrameIndex < frames.length - 1 && !point(frames[contactFrameIndex + 1], ARMS[arm].wrist, width, height)) return null;
  let trophy = false;
  let next = hit;
  for (let i = contactFrameIndex - 1; i >= 0; i--) {
    const p = poses[i];
    if (!p || next.t <= p.t || next.t - p.t > MAX_GAP_MS || hit.t - p.t > 500) break;
    if (p.angle < 115) trophy = true;
    next = p;
  }
  const contactTimestamp = hit.t - offsetMs;
  if (!trophy || contactTimestamp < 0) return null;
  const ls = point(frame, 5, width, height), rs = point(frame, 6, width, height);
  const lh = point(frame, 11, width, height), rh = point(frame, 12, width, height);
  const torsoPixelHeight = ls && rs && lh && rh
    ? Math.hypot((ls.x + rs.x - lh.x - rh.x) / 2, (ls.y + rs.y - lh.y - rh.y) / 2) : 0;
  const metersPerPixel = torsoPixelHeight > 0 ? 0.50 / torsoPixelHeight : null;
  let speed = null;
  if (metersPerPixel) {
    let window = [], bestDistance = Infinity;
    for (let i = Math.max(1, contactFrameIndex - 2); i <= Math.min(poses.length - 1, contactFrameIndex + 3); i++) {
      const a = poses[i - 1], b = poses[i];
      if (!a || !b || b.t <= a.t || b.t - a.t > MAX_GAP_MS) { window = []; continue; }
      const mps = Math.hypot(b.wrist.x - a.wrist.x, b.wrist.y - a.wrist.y) * metersPerPixel / ((b.t - a.t) / 1000);
      if (!Number.isFinite(mps) || mps * 2.237 > 65) { window = []; continue; }
      window.push({ mps, t: (a.t + b.t) / 2, i });
      if (window.length > 3) window.shift();
      if (window.length === 3) {
        const distance = Math.abs(window[1].t - hit.t);
        // Only windows spanning the contact frame support an impact estimate.
        if (window[0].i - 1 <= contactFrameIndex && window[2].i >= contactFrameIndex && distance < bestDistance) {
          speed = window.reduce((sum, p) => sum + p.mps, 0) / 3;
          bestDistance = distance;
        }
      }
    }
  }
  return {
    arm, contactFrameIndex, contactTimestamp, elbowAngle: hit.angle,
    insight: extensionInsight(hit.angle), metersPerPixel,
    handSpeedMph: speed === null ? null : speed * 2.237,
    handSpeedKmh: speed === null ? null : speed * 3.6,
    estRacketSpeedMph: speed === null ? null : speed * 2.237 * 1.75,
    estRacketSpeedKmh: speed === null ? null : speed * 3.6 * 1.75,
  };
}