import { describe, expect, it } from 'vitest';
import { basePoints, computeScores, kidsMultiplier, streaks } from './scoring';
import type { EventType, Kid, Meetup, Member } from '../../core/types';

const m = (id: string): Member => ({ id, nickname: id, real_name: null, avatar_data: null, role: 'member', active: true, sort_order: 0 });
const t = (id: string, rule: any): EventType => ({ id, name: id, emoji: '', rule, active: true, sort_order: 0 });
const mt = (type_id: string, date: string, attendance: any[], start_time: string | null = null): Meetup =>
  ({ id: Math.random() + '', date, start_time, type_id, comment: null, created_by: null, created_at: '', deleted_at: null, attendance });

describe('basePoints', () => {
  it('beer fixed', () => expect(basePoints({ kind: 'fixed', points: 1 }, mt('', '', []), { sleep_time: null, won: null })).toBe(1));
  it('party sleep hours', () => {
    const r = { kind: 'sleep_hours', per_hour: 1 } as const;
    const p = (s: string | null) => basePoints(r, mt('', '', []), { sleep_time: s, won: null });
    expect(p('01:00')).toBe(1);
    expect(p('02:59')).toBe(2);
    expect(p('05:30:00')).toBe(5);
    expect(p('00:30')).toBe(0);
    expect(p('23:30')).toBe(0);
    expect(p(null)).toBe(0);
  });
  it('padel win', () => {
    const r = { kind: 'win', points: 1 } as const;
    expect(basePoints(r, mt('', '', []), { sleep_time: null, won: true })).toBe(1);
    expect(basePoints(r, mt('', '', []), { sleep_time: null, won: false })).toBe(0);
  });
  it('bike meet time', () => {
    const r = { kind: 'meet_time', cutoff: '09:00', early: -3, late: -1 } as const;
    expect(basePoints(r, mt('', '', [], '08:30'), { sleep_time: null, won: null })).toBe(-3);
    expect(basePoints(r, mt('', '', [], '09:00'), { sleep_time: null, won: null })).toBe(-1);
    expect(basePoints(r, mt('', '', [], null), { sleep_time: null, won: null })).toBe(-1);
  });
});

describe('kids multiplier', () => {
  const kids: Kid[] = [
    { id: '1', member_id: 'a', name: null, born_on: '2025-01-01' },
    { id: '2', member_id: 'a', name: null, born_on: '2026-06-01' },
    { id: '3', member_id: 'b', name: null, born_on: null },
  ];
  it('counts by birth date', () => {
    expect(kidsMultiplier(kids, 'a', '2024-12-31')).toBe(1);
    expect(kidsMultiplier(kids, 'a', '2025-06-01')).toBe(2);
    expect(kidsMultiplier(kids, 'a', '2026-07-01')).toBe(4);
    expect(kidsMultiplier(kids, 'b', '2000-01-01')).toBe(2);
    expect(kidsMultiplier(kids, 'c', '2026-01-01')).toBe(1);
  });
});

describe('computeScores', () => {
  const types = [t('beer', { kind: 'fixed', points: 1 }), t('bike', { kind: 'meet_time', cutoff: '09:00', early: -3, late: -1 }), t('wk', { kind: 'fixed', points: 10 })];
  const kids: Kid[] = [{ id: 'k', member_id: 'aniol', name: null, born_on: null }];
  const meetups = [
    mt('beer', '2026-11-20', [{ member_id: 'aniol' }, { member_id: 'pere' }]),
    mt('bike', '2026-11-10', [{ member_id: 'aniol' }], '08:00'),
    mt('wk', '2025-05-01', [{ member_id: 'pere' }]),
  ];
  const adj = [{ id: 'x', member_id: 'pere', points: -2, reason: 'tard', date: '2026-11-21', created_by: null, created_at: '' }];
  const now = new Date('2026-11-25T12:00:00');
  it('all time with multiplier on negatives and adjustments not multiplied', () => {
    const s = computeScores([m('aniol'), m('pere')], kids, types, meetups, adj, 'all', null, now);
    const by = Object.fromEntries(s.map((x) => [x.member.id, x.points]));
    expect(by.aniol).toBe(2 - 6);
    expect(by.pere).toBe(1 + 10 - 2);
    expect(s[0].member.id).toBe('pere');
  });
  it('month filter', () => {
    const s = computeScores([m('aniol'), m('pere')], kids, types, meetups, adj, 'month', null, now);
    expect(Object.fromEntries(s.map((x) => [x.member.id, x.points]))).toEqual({ aniol: -4, pere: -1 });
  });
  it('type filter excludes adjustments', () => {
    const s = computeScores([m('aniol'), m('pere')], kids, types, meetups, adj, 'all', 'beer', now);
    expect(Object.fromEntries(s.map((x) => [x.member.id, x.points]))).toEqual({ aniol: 2, pere: 1 });
  });
});

describe('streaks', () => {
  it('consecutive weeks', () => {
    expect(streaks(['2026-11-24', '2026-11-17', '2026-11-12', '2026-10-01'], '2026-11-25')).toEqual({ current: 3, best: 3 });
    expect(streaks(['2026-10-01'], '2026-11-25')).toEqual({ current: 0, best: 1 });
    expect(streaks([], '2026-11-25')).toEqual({ current: 0, best: 0 });
  });
});
