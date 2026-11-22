/* Experimental 2D swing-speed estimates from saved MoveNet frames (not ball speed).
 * Assumes an adult 0.50 m torso and a 1.75 racket multiplier, neither measured.
 * Input kp is flattened normalised x/y/score; restore video pixels before distances.
 * peakTimestamp is VIDEO milliseconds of peak smoothed speed, NOT acceleration
 * or detected contact. Pose clock = video clock + offsetMs (see replay.js).
 * Hitting-phase detection is separate from speed peaks; pose cannot detect ball contact.
 */
const MIN_CONFIDENCE = 0.35;
const TORSO_METERS = 0.5;
const MPH_PER_MPS = 2.237;
const RACKET_MULTIPLIER = 1.75;
const MAX_HAND_MPH = 65;
const MAX_GAP_MS = 250; // Do not bridge missing tracking or very sparse frames.
const ARMS = { left: { wrist: 9, elbow: 7 }, right: { wrist: 10, elbow: 8 } };

export function speedRating(racketMph) {
  if (racketMph < 50) return "Beginner";
  if (racketMph < 75) return "Club";
  if (racketMph <= 95) return "Advanced";
  return "Pro Pace";
}

function point(kp, index, width, height) {
  if (!kp || kp[index * 3 + 2] < MIN_CONFIDENCE || !Number.isFinite(kp[index * 3 + 2])) return null;
  const x = kp[index * 3] * width,
    y = kp[index * 3 + 1] * height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function body(frame, width, height) {
  if (!frame || !Number.isFinite(frame.t)) return null;
  const ls = point(frame.kp, 5, width, height),
    rs = point(frame.kp, 6, width, height);
  const lh = point(frame.kp, 11, width, height),
    rh = point(frame.kp, 12, width, height);
  if (!ls || !rs || !lh || !rh) return null;
  const shoulder = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const torso = Math.hypot(shoulder.x - (lh.x + rh.x) / 2, shoulder.y - (lh.y + rh.y) / 2);
  return torso > 0 ? { shoulder, torso, ls, rs } : null;
}

/** Estimate the overhead hitting extension, never a generic speed maximum.
 * Requires continuous bent-arm preparation -> rising extension -> follow-through.
 * A straight toss arm does not meet the preparation requirement. No ball/racket tracking.
 */
export function findHittingMoment(frames, { width, height, offsetMs = 0 }) {
  if (
    !Array.isArray(frames) ||
    !(width > 0) ||
    !(height > 0) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(offsetMs)
  )
    return null;
  const candidates = [];
  for (const [arm, indices] of Object.entries(ARMS)) {
    let segment = [];
    function inspect() {
      for (let i = 1; i < segment.length - 1; i++) {
        const hit = segment[i];
        if (hit.angle < 150 || hit.elevation < 0.5) continue;
        const before = segment.slice(0, i).filter((p) => hit.t - p.t <= 1000);
        const after = segment.slice(i + 1).filter((p) => p.t - hit.t <= 700);
        const prepared = before.some((p) => p.angle <= 120 && hit.elevation - p.elevation >= 0.3);
        const followed = after.some((p) => hit.elevation - p.elevation >= 0.3);
        // Use the reach apex of the hitting extension, not an earlier rising frame.
        const higherReach = [...before, ...after].some(
          (p) => p.angle >= 150 && p.elevation > hit.elevation + 0.02,
        );
        if (prepared && followed && !higherReach)
          candidates.push({ t: hit.t, arm, score: hit.elevation + hit.angle / 180 });
      }
      segment = [];
    }
    for (const frame of frames) {
      const b = body(frame, width, height);
      const wrist = b && point(frame.kp, indices.wrist, width, height);
      const elbow = b && point(frame.kp, indices.elbow, width, height);
      if (!b || !wrist || !elbow) {
        inspect();
        continue;
      }
      const shoulder = arm === "left" ? b.ls : b.rs;
      const ux = shoulder.x - elbow.x,
        uy = shoulder.y - elbow.y;
      const vx = wrist.x - elbow.x,
        vy = wrist.y - elbow.y;
      const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      if (!length) {
        inspect();
        continue;
      }
      const previous = segment[segment.length - 1];
      if (previous && (frame.t <= previous.t || frame.t - previous.t > MAX_GAP_MS)) inspect();
      segment.push({
        t: frame.t,
        elevation: (shoulder.y - wrist.y) / b.torso,
        angle: (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / length))) * 180) / Math.PI,
      });
    }
    inspect();
  }
  candidates.sort((a, b) => b.score - a.score || a.t - b.t);
  const best = candidates[0];
  // Equally plausible strokes on opposite arms are not a reliable hitting target.
  if (!best || candidates.some((p) => p.arm !== best.arm && Math.abs(p.score - best.score) < 0.1))
    return null;
  const timestamp = best.t - offsetMs;
  return timestamp >= 0 ? { timestamp, arm: best.arm } : null;
}

/** Returns null rather than a fabricated zero when tracking cannot support an estimate.
 * @param {Array<{t: number, kp: number[] | null}>} frames Stored chronological pose frames.
 * @param {{width: number, height: number, offsetMs?: number}} options Recorded video size and sync.
 */
export function analyzeSwingSpeed(frames, { width, height, offsetMs = 0 }) {
  if (
    !Array.isArray(frames) ||
    !(width > 0) ||
    !(height > 0) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(offsetMs)
  )
    return null;
  const elevation = { left: -Infinity, right: -Infinity };
  // Compare elevation relative to shoulders and torso, not raw image position.
  for (const frame of frames) {
    const b = body(frame, width, height);
    if (!b) continue;
    for (const [arm, indices] of Object.entries(ARMS)) {
      const wrist = point(frame.kp, indices.wrist, width, height);
      const elbow = point(frame.kp, indices.elbow, width, height);
      if (wrist && elbow)
        elevation[arm] = Math.max(elevation[arm], (b.shoulder.y - wrist.y) / b.torso);
    }
  }
  // At least one tracked wrist must rise above its shoulders; exact ties are ambiguous.
  if (Math.max(elevation.left, elevation.right) <= 0 || elevation.left === elevation.right)
    return null;
  const hittingMoment = findHittingMoment(frames, { width, height, offsetMs });
  const dominantArm = hittingMoment?.arm || (elevation.left > elevation.right ? "left" : "right");
  const indices = ARMS[dominantArm];
  let previous = null,
    window = [],
    peak = null;
  for (const frame of frames) {
    const b = body(frame, width, height);
    const wrist = b && point(frame.kp, indices.wrist, width, height);
    const elbow = b && point(frame.kp, indices.elbow, width, height);
    if (!b || !wrist || !elbow) {
      previous = null;
      window = [];
      continue;
    }
    const current = { t: frame.t, wrist, torso: b.torso };
    if (previous) {
      const dt = current.t - previous.t;
      if (dt <= 0 || dt > MAX_GAP_MS) {
        previous = current;
        window = [];
        continue;
      }
      const mps =
        (Math.hypot(wrist.x - previous.wrist.x, wrist.y - previous.wrist.y) *
          (TORSO_METERS / b.torso)) /
        (dt / 1000);
      if (!Number.isFinite(mps) || mps * MPH_PER_MPS > MAX_HAND_MPH) {
        previous = current;
        window = [];
        continue;
      }
      window.push({ mps, t: current.t });
      if (window.length > 3) window.shift();
      if (window.length === 3) {
        // Keep the actual timestamp of the median sample, not a shifted filter endpoint.
        const median = [...window].sort((a, b) => a.mps - b.mps)[1];
        if (median && (!peak || median.mps > peak.mps)) peak = median;
      }
    }
    previous = current;
  }
  if (!peak) return null;
  const mph = peak.mps * MPH_PER_MPS;
  return {
    peakHandSpeedMph: mph,
    peakHandSpeedKmh: peak.mps * 3.6,
    estRacketSpeedMph: mph * RACKET_MULTIPLIER,
    estRacketSpeedKmh: peak.mps * 3.6 * RACKET_MULTIPLIER,
    peakTimestamp: Math.max(0, peak.t - offsetMs),
    speedRating: speedRating(mph * RACKET_MULTIPLIER),
    dominantArm,
  };
}
