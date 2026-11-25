import type { EqResult } from '../../core/types';

/** Per-option counts, rounded % and winners (ties included). `counts` overrides when only totals are known. */
export function tally(votes: EqResult[], counts?: number[]) {
  const by: string[][] = [[], [], [], []];
  for (const v of votes) by[v.option]?.push(v.member_id);
  const c = counts ?? by.map((x) => x.length);
  const total = c.reduce((a, b) => a + b, 0);
  const pct = c.map((n) => (total ? Math.round((n * 100) / total) : 0));
  const max = Math.max(...c);
  const winners = total ? c.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0) : [];
  return { by, counts: c, total, pct, winners };
}

/** Today's question is already fixed, so queue position 1 comes out tomorrow. */
export const whenLabel = (pos: number) => (pos <= 1 ? 'demà' : `d'aquí ${pos} dies`);
