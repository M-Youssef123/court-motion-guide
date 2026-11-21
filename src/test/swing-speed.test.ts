import { describe, expect, it } from 'vitest';
// @ts-expect-error static app uses plain JS modules
import { analyzeSwingSpeed, speedRating } from '../../public/serve-coach/js/features.js';

function framesFor(mps: number[], arm = 'right', width = 1000, height = 1000, scale = 1) {
  let x = 300 * scale;
  const torso = 200 * scale;
  return [0, ...mps].map((speed, n) => {
    if (n) x += speed * 0.1 * torso / 0.50;
    const kp = Array<number>(51).fill(0);
    const set = (i: number, px: number, py: number, score = 0.9) => {
      kp[i * 3] = px / width; kp[i * 3 + 1] = py / height; kp[i * 3 + 2] = score;
    };
    set(5, 250 * scale, 400 * scale); set(6, 350 * scale, 400 * scale);
    set(11, 250 * scale, 600 * scale); set(12, 350 * scale, 600 * scale);
    set(7, 250 * scale, 450 * scale); set(8, 350 * scale, 450 * scale);
    set(9, arm === 'left' ? x : 250 * scale, (arm === 'left' ? 200 : 450) * scale);
    set(10, arm === 'right' ? x : 350 * scale, (arm === 'right' ? 200 : 450) * scale);
    return { t: n * 100, kp };
  });
}
const size = { width: 1000, height: 1000 };

describe('kinematic swing-speed estimates', () => {
  it('uses a 0.50 m torso and actual frame intervals for wrist displacement', () => {
    const result = analyzeSwingSpeed(framesFor([2, 2, 2]), size);
    expect(result?.peakHandSpeedMph).toBeCloseTo(2 * 2.237, 8);
  });
  it('converts metres per second to mph with 2.237 and km/h with 3.6', () => {
    const result = analyzeSwingSpeed(framesFor([4, 4, 4]), size);
    expect(result?.peakHandSpeedMph).toBeCloseTo(8.948, 8);
    expect(result?.peakHandSpeedKmh).toBeCloseTo(14.4, 8);
  });
  it('uses 1.75 times peak wrist speed for both racket estimates', () => {
    const result = analyzeSwingSpeed(framesFor([4, 4, 4]), size);
    expect(result?.estRacketSpeedMph).toBeCloseTo(15.659, 8);
    expect(result?.estRacketSpeedKmh).toBeCloseTo(25.2, 8);
  });
  it('auto-selects the highest-reaching wrist on either arm', () => {
    expect(analyzeSwingSpeed(framesFor([2, 2, 2], 'left'), size)?.dominantArm).toBe('left');
    expect(analyzeSwingSpeed(framesFor([2, 2, 2], 'right'), size)?.dominantArm).toBe('right');
  });
  it('restores pixel aspect ratio and is invariant to player image scale', () => {
    const a = analyzeSwingSpeed(framesFor([2, 2, 2]), size);
    const b = analyzeSwingSpeed(framesFor([2, 2, 2], 'right', 1920, 1080, 0.5), { width: 1920, height: 1080 });
    expect(b?.peakHandSpeedMph).toBeCloseTo(a?.peakHandSpeedMph, 8);
  });
  it('uses a three-frame median to reject isolated jitter spikes', () => {
    expect(analyzeSwingSpeed(framesFor([2, 20, 2]), size)?.peakHandSpeedMph).toBeCloseTo(4.474, 8);
  });
  it('rejects hand speeds above 65 mph before smoothing', () => {
    expect(analyzeSwingSpeed(framesFor([30, 30, 30]), size)).toBeNull();
    expect(analyzeSwingSpeed(framesFor([65 / 2.237, 65 / 2.237, 65 / 2.237]), size)?.peakHandSpeedMph).toBeCloseTo(65, 6);
  });
  it('rejects confidence below 0.35 on wrist, elbow, shoulders or hips', () => {
    for (const index of [10, 8, 5, 6, 11, 12]) {
      const frames = framesFor([2, 2, 2]);
      for (const f of frames) f.kp[index * 3 + 2] = 0.349;
      expect(analyzeSwingSpeed(frames, size)).toBeNull();
    }
  });
  it('accepts confidence at exactly 0.35', () => {
    const frames = framesFor([2, 2, 2]);
    for (const f of frames) for (const index of [10, 8, 5, 6, 11, 12]) f.kp[index * 3 + 2] = 0.35;
    expect(analyzeSwingSpeed(frames, size)?.peakHandSpeedMph).toBeCloseTo(4.474, 8);
  });
  it('does not bridge missing frames or long tracking gaps', () => {
    const frames = framesFor([2, 2, 2]);
    expect(analyzeSwingSpeed([frames[0], { t: 50, kp: null }, ...frames.slice(1)], size)).toBeNull();
    expect(analyzeSwingSpeed(frames.map(f => ({ ...f, t: f.t * 3 })), size)).toBeNull();
  });
  it('withholds empty, incomplete, duplicate-time and zero-torso data', () => {
    expect(analyzeSwingSpeed([], size)).toBeNull();
    expect(analyzeSwingSpeed(framesFor([2, 2]), size)).toBeNull();
    expect(analyzeSwingSpeed(framesFor([2, 2, 2]).map(f => ({ ...f, t: 0 })), size)).toBeNull();
    const frames = framesFor([2, 2, 2]);
    for (const f of frames) { f.kp[11 * 3 + 1] = 0.4; f.kp[12 * 3 + 1] = 0.4; }
    expect(analyzeSwingSpeed(frames, size)).toBeNull();
  });
  it('returns the actual median speed timestamp in video milliseconds, not acceleration', () => {
    expect(analyzeSwingSpeed(framesFor([1, 3, 2]), { ...size, offsetMs: -350 })?.peakTimestamp).toBe(650);
  });
  it('rates racket speed below 50 mph as Beginner', () => {
    expect(speedRating(49.99)).toBe('Beginner');
  });
  it('rates racket speed from 50 to below 75 mph as Club', () => {
    expect(speedRating(50)).toBe('Club'); expect(speedRating(74.99)).toBe('Club');
  });
  it('rates racket speed from 75 through 95 mph as Advanced', () => {
    expect(speedRating(75)).toBe('Advanced'); expect(speedRating(95)).toBe('Advanced');
  });
  it('rates racket speed above 95 mph as Pro Pace', () => {
    expect(speedRating(95.01)).toBe('Pro Pace');
  });
});