import type { Adjustment, Attendance, EventType, Kid, Meetup, Member, Rule } from '../../core/types';

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Base points for one attendee of one meetup, before the kids multiplier. */
export function basePoints(rule: Rule, meetup: Pick<Meetup, 'start_time'>, a: Pick<Attendance, 'sleep_time' | 'won'>): number {
  switch (rule.kind) {
    case 'fixed':
      return rule.points;
    case 'sleep_hours': {
      if (!a.sleep_time) return 0;
      const min = toMin(a.sleep_time);
      // 00:00–11:59 counts as "after midnight"; 12:00–23:59 means you went to bed before midnight
      if (min >= 12 * 60) return 0;
      return Math.floor(min / 60) * rule.per_hour;
    }
    case 'win':
      return a.won ? rule.points : 0;
    case 'meet_time':
      if (meetup.start_time && toMin(meetup.start_time) < toMin(rule.cutoff)) return rule.early;
      return rule.late;
  }
}

/** 2^(kids born on or before date). Kids without birth date always count. */
export function kidsMultiplier(kids: Kid[], memberId: string, date: string): number {
  const n = kids.filter((k) => k.member_id === memberId && (!k.born_on || k.born_on <= date)).length;
  return 2 ** n;
}

export type Period = 'month' | 'year' | 'all';

export function inPeriod(date: string, period: Period, now = new Date()): boolean {
  if (period === 'all') return true;
  const y = String(now.getFullYear());
  if (period === 'year') return date.startsWith(y);
  return date.startsWith(`${y}-${String(now.getMonth() + 1).padStart(2, '0')}`);
}

export interface PointLine {
  meetup: Meetup;
  type: EventType;
  base: number;
  mult: number;
  points: number;
}

export interface Score {
  member: Member;
  points: number;
  attendances: number;
  byType: Record<string, { count: number; points: number }>;
  adjustments: number;
  lines: PointLine[];
}

export function computeScores(
  members: Member[], kids: Kid[], types: EventType[], meetups: Meetup[], adjustments: Adjustment[],
  period: Period, typeFilter: string | null = null, now = new Date(),
): Score[] {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const scores = new Map<string, Score>(
    members.filter((m) => m.active).map((m) => [m.id, { member: m, points: 0, attendances: 0, byType: {}, adjustments: 0, lines: [] }]),
  );
  for (const mt of meetups) {
    if (mt.deleted_at || !inPeriod(mt.date, period, now)) continue;
    if (typeFilter && mt.type_id !== typeFilter) continue;
    const type = typeById.get(mt.type_id);
    if (!type) continue;
    for (const a of mt.attendance) {
      const s = scores.get(a.member_id);
      if (!s) continue;
      const base = basePoints(type.rule, mt, a);
      const mult = kidsMultiplier(kids, a.member_id, mt.date);
      const pts = base * mult;
      s.points += pts;
      s.attendances += 1;
      const bt = (s.byType[type.id] ??= { count: 0, points: 0 });
      bt.count += 1;
      bt.points += pts;
      s.lines.push({ meetup: mt, type, base, mult, points: pts });
    }
  }
  if (!typeFilter) {
    for (const adj of adjustments) {
      if (!inPeriod(adj.date, period, now)) continue;
      const s = scores.get(adj.member_id);
      if (!s) continue;
      s.points += adj.points;
      s.adjustments += adj.points;
    }
  }
  return [...scores.values()].sort(
    (a, b) => b.points - a.points || b.attendances - a.attendances || a.member.nickname.localeCompare(b.member.nickname),
  );
}

/** ISO week key, e.g. 2026-W48 */
export function isoWeek(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekIndex(date: string): number {
  const d = new Date(date + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  return Math.floor((d.getTime() / 864e5 - day + 3) / 7); // monotonic Monday-based index
}

/** Consecutive weeks with ≥1 attendance. current = streak reaching this week or last week. */
export function streaks(dates: string[], today = new Date().toISOString().slice(0, 10)): { current: number; best: number } {
  const weeks = [...new Set(dates.map(weekIndex))].sort((a, b) => a - b);
  let best = 0, run = 0, prev = NaN;
  for (const w of weeks) {
    run = w === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = w;
  }
  const tw = weekIndex(today);
  const current = weeks.length && (prev === tw || prev === tw - 1) ? run : 0;
  return { current, best };
}

export function describeRule(r: Rule): string {
  switch (r.kind) {
    case 'fixed': return `${r.points > 0 ? '+' : ''}${r.points} punt${Math.abs(r.points) === 1 ? '' : 's'}`;
    case 'sleep_hours': return `+${r.per_hour} per cada hora després de les 00:00 que te'n vas a dormir`;
    case 'win': return `+${r.points} si guanyes, 0 si perds`;
    case 'meet_time': return `${r.early} si quedeu abans de les ${r.cutoff}, ${r.late} si és més tard`;
  }
}
