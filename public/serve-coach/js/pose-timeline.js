/** First index at or after a timestamp in an ascending array of finite times. */
export function lowerBoundTime(samples, timestamp) {
  let left = 0;
  let right = samples.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (samples[mid].t < timestamp) left = mid + 1;
    else right = mid;
  }
  return left;
}

export function nearestSample(samples, timestamp, maxGapMs) {
  if (!Number.isFinite(timestamp)) return null;
  const index = lowerBoundTime(samples, timestamp);
  const before = samples[index - 1];
  const after = samples[index];
  const closest =
    before && (!after || timestamp - before.t <= after.t - timestamp) ? before : after;
  return closest && Math.abs(closest.t - timestamp) <= maxGapMs ? closest : null;
}
