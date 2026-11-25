import { describe, expect, it } from 'vitest';
import { QUESTIONS, drawMatch, randomWinChance } from './questions';

describe('question bank', () => {
  it('has 30 unique questions with 4 distinct options', () => {
    expect(QUESTIONS.length).toBe(30);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(30);
    for (const q of QUESTIONS) if (!q.faces) expect(new Set(q.options).size).toBe(4);
  });
  it('draws 5 distinct questions, ≤2 face questions, 4 options each', () => {
    const ids = Array.from({ length: 11 }, (_, i) => 'm' + i);
    for (let i = 0; i < 200; i++) {
      const m = drawMatch(ids);
      expect(m.length).toBe(5);
      expect(new Set(m.map((x) => x.q)).size).toBe(5);
      expect(m.filter((x) => QUESTIONS.find((q) => q.id === x.q)!.faces).length).toBeLessThanOrEqual(2);
      for (const x of m) expect(new Set(x.options).size).toBe(4);
    }
  });
  it('skips face questions with < 4 members', () => {
    const m = drawMatch(['a', 'b']);
    expect(m.every((x) => !QUESTIONS.find((q) => q.id === x.q)!.faces)).toBe(true);
  });
  it('random win chance', () => expect(randomWinChance()).toBeCloseTo(0.2373, 3));
});
