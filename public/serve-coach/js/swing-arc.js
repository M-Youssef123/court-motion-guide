import { toScreen } from "./overlay.js";

export function selectSwing(wrist, preparationMs, apexMs, finishMs) {
  if (
    !wrist ||
    ![preparationMs, apexMs, finishMs].every(Number.isFinite) ||
    !(preparationMs < apexMs && apexMs < finishMs)
  )
    return null;
  const samples = wrist.trajectory.filter((p) => p.t >= preparationMs && p.t <= finishMs);
  if (
    samples.length < 4 ||
    samples[0].t >= apexMs ||
    samples.at(-1).t <= apexMs ||
    samples.slice(1).some((p) => !p.connected || !Number.isFinite(p.speed))
  )
    return null;
  const apex = samples.reduce((a, b) => (a.y <= b.y ? a : b));
  const peak = samples.slice(1).reduce((a, b) => (a.speed >= b.speed ? a : b));
  return { samples, apex, peak };
}

/** A labelled partial arc when the wrist is visible but a phase boundary is missing. */
export function selectTrackedSwing(wrist, apexMs) {
  if (!wrist || !Number.isFinite(apexMs)) return null;
  const samples = wrist.trajectory;
  const apexIndex = samples.findIndex((point) => point.t >= apexMs);
  if (apexIndex < 1 || Math.abs(samples[apexIndex].t - apexMs) > 100) return null;
  let start = apexIndex;
  let end = apexIndex;
  while (start > 0 && samples[start].connected && samples[start - 1].t >= apexMs - 700) start--;
  while (
    end + 1 < samples.length &&
    samples[end + 1].connected &&
    samples[end + 1].t <= apexMs + 900
  )
    end++;
  if (end <= apexIndex || start >= apexIndex) return null;
  const segment = selectSwing(wrist, samples[start].t, apexMs, samples[end].t);
  return segment && { ...segment, partial: true };
}

export function drawSwingArc(overlay, samples, { poseMs, peak, apex, trailing }) {
  const { ctx, mapping, dpr, video } = overlay;
  if (!mapping || !samples.length) return;
  const screen = (p) =>
    toScreen(mapping, { x: p.x * video.videoWidth, y: p.y * video.videoHeight });
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineWidth = trailing ? 3 : 5;
  const visible = (p) => !trailing || (p.t >= poseMs - 300 && p.t <= poseMs);
  let previous = null;
  for (const p of samples) {
    if (trailing && p.t > poseMs) break;
    if (previous && p.connected && visible(p) && visible(previous)) {
      const a = screen(previous),
        b = screen(p);
      const fraction = Math.min(1, p.speed / (peak?.speed || 1));
      ctx.strokeStyle = `hsl(${210 * (1 - fraction)} 95% 57%)`;
      ctx.globalAlpha = trailing ? 0.25 + (0.75 * (p.t - poseMs + 300)) / 300 : 0.9;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    previous = p;
  }
  ctx.globalAlpha = 1;
  for (const [point, isApex] of [
    [apex, true],
    [peak, false],
  ]) {
    if (!point || !visible(point)) continue;
    const { x, y } = screen(point);
    ctx.lineWidth = 2;
    ctx.strokeStyle = isApex ? "#67e8f9" : "#fb7044";
    ctx.beginPath();
    if (isApex) {
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x, y + 10);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
    } else ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}
