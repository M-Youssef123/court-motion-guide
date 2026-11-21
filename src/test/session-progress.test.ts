import { describe, expect, it } from 'vitest';
// @ts-expect-error static JS module
import { comparisonSeries, comparisonText } from '../../public/serve-coach/js/session-progress.js';
// @ts-expect-error static JS module
import { answerCoach, recommendedDrill } from '../../public/serve-coach/js/training.js';

const sessions = ['first', 'previous', 'current'].map((id, i) => ({
  id, createdAt: `2026-01-0${i + 1}T12:00:00Z`,
}));
const clips = sessions.flatMap((s) => ['a', 'b', 'upload'].map((suffix) => ({
  id: `${s.id}-${suffix}`, sessionId: s.id, createdAt: s.createdAt, tripodPosition: 'side',
  side: 'deuce', camera: { facing: 'environment' }, video: { orientation: 'landscape' },
  source: suffix === 'upload' ? 'upload' : 'camera',
})));
const analyses = clips.map((clip, i) => ({
  clipId: clip.id, handSource: 'recorded', dominantHand: 'right',
  coaching: {
    status: 'supported',
    positive: { text: 'Your serving arm opened into overhead reach.', evidence: { elbowAngleDegrees: 140 + i, timestampMs: 1250 } },
  },
}));
const data = { sessions, clips, analyses };

describe('saved evidence', () => {
  it('compares distinct past sessions and excludes uploads with unknown setup', () => {
    const series = comparisonSeries(data);
    expect(series.map((row: { count: number; mean: number; spread: number }) => [row.count, row.mean, row.spread]))
      .toEqual([[2, 140.5, 0.5], [2, 143.5, 0.5], [2, 146.5, 0.5]]);
    expect(comparisonText(series, 'first')).toContain('+6.0°');
    expect(comparisonText(series, 'last')).toContain('+3.0°');
    expect(comparisonSeries(data, 'current-upload')).toEqual([]);
  });

  it('scopes coach answers to the selected recording and uses insufficient-data responses', () => {
    const feedback = analyses[0]?.coaching;
    expect(answerCoach('technique', { feedback, comparisons: [], sessionId: 'first' })).toContain('1.25 s');
    expect(answerCoach('improvement', { feedback, comparisons: comparisonSeries(data), sessionId: 'first' })).toMatch(/At least two/);
    expect(answerCoach('consistency', { comparisons: comparisonSeries(data), sessionId: 'current' })).toContain('0.5°');
    expect(answerCoach('drill', { comparisons: [] })).toMatch(/insufficient/);
  });

  it('matches drills to supported observations', () => {
    expect(recommendedDrill({ status: 'insufficient' })).toBeNull();
    expect(recommendedDrill({ status: 'supported' }).id).toBe('bend-to-reach');
    expect(recommendedDrill({ status: 'supported', improvement: { text: 'Partly bent' } }).id).toBe('comfortable-reach');
  });
});
