import { toScreen } from "./overlay.js";
import { lowerBoundTime } from "./pose-timeline.js";

/** Only the preceding 300 ms, in the saved pose clock; never future movement. */
export function wristTrailSamples(trajectory, poseMs) {
  if (!Array.isArray(trajectory) || !Number.isFinite(poseMs)) return [];
  const start = lowerBoundTime(trajectory, poseMs - 300);
  let end = start;
  while (end < trajectory.length && trajectory[end].t <= poseMs) end++;
  return trajectory.slice(start, end);
}

export function drawSwingArc(overlay, samples, { poseMs, peak }) {
  const { ctx, mapping, dpr, video } = overlay;
  if (!mapping || !samples.length) return;
  const screen = (p) =>
    toScreen(mapping, { x: p.x * video.videoWidth, y: p.y * video.videoHeight });
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  const visible = (p) => p.t >= poseMs - 300 && p.t <= poseMs;
  let previous = null;
  for (const p of samples) {
    if (p.t > poseMs) break;
    if (previous && p.connected && visible(p) && visible(previous)) {
      const a = screen(previous),
        b = screen(p);
      const fraction = Math.min(1, p.speed / (peak?.speed || 1));
      ctx.strokeStyle = `hsl(${210 * (1 - fraction)} 95% 57%)`;
      ctx.globalAlpha = 0.25 + (0.75 * (p.t - poseMs + 300)) / 300;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    previous = p;
  }
  ctx.restore();
}
