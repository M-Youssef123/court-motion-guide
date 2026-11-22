import { openUploadVideo, seekUploadVideo } from "./upload-media.js";
import { clearPoint, detectServePhases, nearestPhasePose } from "./serve-phases.js";
import { analyzeServeContact, servingArm } from "./contact-analysis.js";

export const BALL_TOSS_VERSION = 1;

export function ballCandidates({ data, width, height }, region) {
  const mask = new Uint8Array(width * height);
  const x0 = Math.max(0, Math.floor(region.left * width));
  const x1 = Math.min(width, Math.ceil(region.right * width));
  const y0 = Math.max(0, Math.floor(region.top * height));
  const y1 = Math.min(height, Math.ceil(region.bottom * height));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * width + x,
        p = i * 4;
      const r = data[p],
        g = data[p + 1],
        b = data[p + 2];
      if (g >= 105 && r >= g * 0.52 && r <= g * 1.13 && b <= g * 0.67 && g - b >= 42) mask[i] = 1;
    }
  const result = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const pending = [i];
      mask[i] = 0;
      let n = 0,
        sx = 0,
        sy = 0,
        minX = x,
        maxX = x,
        minY = y,
        maxY = y;
      while (pending.length) {
        const j = pending.pop(),
          px = j % width,
          py = Math.floor(j / width);
        n++;
        sx += px;
        sy += py;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
        for (const neighbor of [
          px > x0 ? j - 1 : -1,
          px + 1 < x1 ? j + 1 : -1,
          j - width,
          j + width,
        ]) {
          if (mask[neighbor]) {
            mask[neighbor] = 0;
            pending.push(neighbor);
          }
        }
      }
      const w = maxX - minX + 1,
        h = maxY - minY + 1;
      if (
        n >= 2 &&
        n <= Math.max(12, width * height * 0.001) &&
        Math.max(w, h) / Math.min(w, h) <= 2.5 &&
        n >= w * h * 0.42 &&
        minX > x0 &&
        maxX < x1 - 1 &&
        minY > y0 &&
        maxY < y1 - 1
      ) {
        result.push({ x: (sx / n + 0.5) / width, y: (sy / n + 0.5) / height });
      }
    }
  return result;
}

/** Follow a single plausible image-plane arc from the tossing hand. */
export function traceBallToss(samples, release, aspect) {
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  let tracks = [];
  const complete = [];
  for (const { t, candidates } of samples) {
    const next = [];
    for (const path of tracks) {
      const last = path.at(-1),
        before = path.at(-2);
      const dt = t - last.t;
      if (dt <= 0 || dt > 110) {
        complete.push(path);
        continue;
      }
      const priorDt = before ? last.t - before.t : dt;
      const position = before
        ? {
            x: last.x + ((last.x - before.x) * dt) / priorDt,
            y: last.y + ((last.y - before.y) * dt) / priorDt,
          }
        : last;
      const limit = before ? 0.055 : 0.1;
      const matches = candidates
        .filter(
          (p) =>
            distance(p, position) < limit &&
            (!before ? p.y < last.y + 0.015 : distance(p, last) < 0.14),
        )
        .sort((a, b) => distance(a, position) - distance(b, position))
        .slice(0, 2);
      if (!matches.length) next.push(path);
      else for (const p of matches) next.push([...path, { ...p, t }]);
    }
    if (Math.abs(t - release.t) <= 140) {
      for (const p of candidates) if (distance(p, release) < 0.075) next.push([{ ...p, t }]);
    }
    tracks = next.sort((a, b) => b.length - a.length).slice(0, 16);
  }
  complete.push(...tracks);
  const qualified = complete
    .flatMap((path) => {
      const apex = path.reduce((best, p, i) => (p.y < path[best].y ? i : best), 0);
      if (
        path.length < 6 ||
        apex < 2 ||
        apex + 2 >= path.length ||
        path[0].y - path[apex].y < 0.055 ||
        path.at(-1).y - path[apex].y < 0.025
      )
        return [];
      const rise = path.slice(1, apex + 1).filter((p, i) => p.y < path[i].y).length;
      const fall = path.slice(apex + 1).filter((p, i) => p.y > path[apex + i].y).length;
      return rise >= Math.ceil(apex * 0.7) && fall >= Math.ceil((path.length - apex - 1) * 0.7)
        ? [{ path, apex: path[apex] }]
        : [];
    })
    .sort((a, b) => b.path.length - a.path.length);
  const best = qualified[0];
  if (
    !best ||
    qualified.some(
      (track) =>
        track.path.length >= best.path.length - 1 && distance(track.apex, best.apex) > 0.045,
    )
  )
    return null;
  return best;
}

/**
 * Look for a visible post-toss departure near the pose-estimated overhead reach.
 * A color blob and wrist vicinity support a review cue only.
 */
export function possibleContact(samples, track, reach, aspect) {
  if (!reach) return null;
  const distance = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const nearby = track.path.filter(
    (p) => p.t > track.apex.t && Math.abs(p.t - reach.t) <= 125 && distance(p, reach) <= 0.18,
  );
  for (const point of nearby) {
    const previous = track.path[track.path.indexOf(point) - 1];
    const next = samples.find((sample) => sample.t > point.t);
    if (!previous || !next || next.t - point.t > 62) continue;
    const ratio = (next.t - point.t) / (point.t - previous.t);
    const projected = {
      x: point.x + (point.x - previous.x) * ratio,
      y: point.y + (point.y - previous.y) * ratio,
    };
    if (next.candidates.some((candidate) => distance(candidate, projected) < 0.032)) continue;
    const departures = next.candidates.filter((candidate) => {
      const shift = distance(candidate, point);
      return (
        shift >= 0.055 &&
        shift < 0.2 &&
        shift > distance(previous, point) * 1.8 &&
        distance(candidate, projected) > 0.045
      );
    });
    if (departures.length === 1) return point.t;
  }
  return null;
}

export async function scanBallToss(video, url, frames, clip, signal) {
  const arm = servingArm(clip.dominantHand || clip.servingArm);
  const offset = clip.sync?.offsetMs;
  if (!arm || !Number.isFinite(offset)) return null;
  const reach = analyzeServeContact(frames, {
    width: clip.video?.width,
    height: clip.video?.height,
    arm,
    offsetMs: offset,
  });
  const { toss, trophy } = detectServePhases(frames, clip, offset, reach);
  if (!toss || !trophy) return null;
  const hand = arm === "right" ? 9 : 10;
  const frame = frames[toss.frameIndex];
  if (!clearPoint(frame, hand) || !clearPoint(frame, 0)) return null;
  await openUploadVideo(video, url, { signal });
  const scale = 384 / Math.max(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const r = { x: frame.kp[hand * 3], y: frame.kp[hand * 3 + 1], t: toss.videoTimestampMs };
  const xHead = frame.kp[0],
    yHead = frame.kp[1];
  const aspect = canvas.width / canvas.height;
  const margin = 0.25 / aspect;
  const region = {
    left: Math.min(r.x, xHead) - margin,
    right: Math.max(r.x, xHead) + margin,
    top: 0,
    bottom: Math.max(yHead, r.y) + 0.08,
  };
  const duration = Number.isFinite(video.duration) ? video.duration * 1000 : clip.video.durationMs;
  const end = Math.min(duration - 30, r.t + 1800);
  const samples = [];
  for (let t = Math.max(0, r.t - 130); t <= end; t += 42) {
    await seekUploadVideo(video, t / 1000, { signal, timeoutMs: 3500 });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    samples.push({
      t,
      candidates: ballCandidates(ctx.getImageData(0, 0, canvas.width, canvas.height), region),
    });
  }
  const track = traceBallToss(samples, r, aspect);
  if (!track) return null;
  const apexPose = nearestPhasePose(frames, track.apex.t, offset, 100);
  if (!clearPoint(apexPose, 0) || apexPose.kp[1] <= track.apex.y) return null;
  const wrist = arm === "right" ? 10 : 9;
  const reachFrame = frames[reach?.contactFrameIndex];
  const reachPoint = clearPoint(reachFrame, wrist)
    ? {
        x: reachFrame.kp[wrist * 3],
        y: reachFrame.kp[wrist * 3 + 1],
        t: reach.contactTimestamp,
      }
    : null;
  return {
    possibleContactVideoMs: possibleContact(samples, track, reachPoint, aspect),
    version: BALL_TOSS_VERSION,
    samples: track.path.length,
    track: track.path,
    apexVideoMs: track.apex.t,
    heightAboveHeadPct: (apexPose.kp[1] - track.apex.y) * 100,
    driftFromHeadPct: (track.apex.x - xHead) * 100,
    source: "image-plane color and trajectory estimate",
  };
}
