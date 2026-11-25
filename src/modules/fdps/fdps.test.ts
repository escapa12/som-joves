import { describe, expect, it } from 'vitest';
import { periodFrom } from './period';

describe('fdps periodFrom', () => {
  it('month / year / always', () => {
    expect(periodFrom('mes', '2026-11-25')).toBe('2026-11-01');
    expect(periodFrom('any', '2026-11-25')).toBe('2026-01-01');
    expect(periodFrom('sempre', '2026-11-25')).toBeNull();
  });
});
