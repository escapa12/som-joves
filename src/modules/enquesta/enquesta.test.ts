import { describe, expect, it } from 'vitest';
import { BANK } from './bank';
import { tally, whenLabel } from './logic';
import sql from '../../../supabase/schema.sql?raw';

describe('enquesta bank', () => {
  it('has 30 questions with 4 distinct options and unique ids', () => {
    expect(BANK.length).toBeGreaterThanOrEqual(30);
    expect(new Set(BANK.map((b) => b.id)).size).toBe(BANK.length);
    for (const b of BANK) {
      expect(b.options).toHaveLength(4);
      expect(new Set(b.options.map((o) => o.toLowerCase())).size).toBe(4);
      expect(b.q.length).toBeLessThanOrEqual(200);
      for (const o of b.options) expect(o.length).toBeLessThanOrEqual(80);
    }
  });
  it('matches the eq_bank seed in schema.sql', () => {
    const esc = (s: string) => "'" + s.replace(/'/g, "''") + "'";
    for (const b of BANK) expect(sql).toContain(`(${b.id}, ${esc(b.q)}, array[${b.options.map(esc).join(', ')}])`);
  });
});

describe('enquesta tally', () => {
  it('counts, percentages and ties', () => {
    const t = tally([{ member_id: 'a', option: 0 }, { member_id: 'b', option: 2 }, { member_id: 'c', option: 2 }, { member_id: 'd', option: 0 }]);
    expect(t.counts).toEqual([2, 0, 2, 0]);
    expect(t.pct).toEqual([50, 0, 50, 0]);
    expect(t.winners).toEqual([0, 2]);
    expect(t.by[2]).toEqual(['b', 'c']);
  });
  it('no votes → no winners', () => {
    expect(tally([], [0, 0, 0, 0])).toMatchObject({ total: 0, winners: [], pct: [0, 0, 0, 0] });
  });
  it('queue labels', () => {
    expect(whenLabel(1)).toBe('demà');
    expect(whenLabel(3)).toBe("d'aquí 3 dies");
  });
});
