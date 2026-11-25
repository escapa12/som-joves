// Demo backend: everything in this browser (localStorage). Used when no Supabase env is configured.
import type { Api, MeetupDraft } from './api';
import type { AppData, Attendance, AuditEntry, Member, NmMatch, TierGame } from './types';

interface DemoState extends AppData {
  me: string | null;
  pins: Record<string, string>;
  audit: AuditEntry[];
  tiers: { id: string; placements: any; candidates: string[]; created_at: string; creator_id: string; real_index: number }[];
  nm?: { id: string; items: NmMatch['items']; created_at: string; creator_id: string; answers: number[] }[];
  nmPlays?: { match_id: string; member_id: string; answers: number[]; lost_at: number | null; finished: boolean }[];
  guesses: { game_id: string; member_id: string; category_index: number; creator_guess_id: string | null; correct_category: boolean; correct_creator: boolean }[];
}

const KEY = 'somjoves-demo-v1';
const uid = () => (crypto as any).randomUUID?.() ?? Math.random().toString(36).slice(2);
const today = (d = 0) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

function seed(): DemoState {
  const names: [string, string][] = [
    ['Escarpa', 'ArnauE'], ['Markina', 'ArnauM'], ['Pere3', 'Pere'], ['KarbonEnergy', 'Oriol'], ['Fletxa Bava', 'Pau'],
    ['DjNovita', 'Pol'], ['Granate', 'Marc'], ['Aniol', 'Aniol'], ['MonkiBusiness', 'Sergi'], ['WillyBux', 'Guillem'],
  ];
  const avatars: Record<string, string> = (window as any).__DEMO_AVATARS ?? {};
  const members: Member[] = names.map(([n, r], i) => ({
    id: 'm' + i, nickname: n, real_name: r, avatar_data: avatars[n] ?? null,
    role: i === 0 ? 'admin' : 'member', active: true, sort_order: i,
  }));
  const T = [
    { id: 't1', name: 'Cervesa', emoji: '🍺', rule: { kind: 'fixed', points: 1 } },
    { id: 't2', name: 'Veure el Barça', emoji: '⚽', rule: { kind: 'fixed', points: 1 } },
    { id: 't3', name: 'Festa', emoji: '🎉', rule: { kind: 'sleep_hours', per_hour: 1 } },
    { id: 't4', name: 'Pàdel', emoji: '🎾', rule: { kind: 'win', points: 1 } },
    { id: 't5', name: 'Bicicleta', emoji: '🚴', rule: { kind: 'meet_time', cutoff: '09:00', early: -3, late: -1 } },
    { id: 't6', name: 'Pla de cap de setmana', emoji: '🏕️', rule: { kind: 'fixed', points: 10 } },
  ].map((t, i) => ({ ...t, active: true, sort_order: i })) as any;
  const mk = (d: number, type: string, who: number[], extra: Partial<Attendance>[] = [], start: string | null = null, comment: string | null = null) => ({
    id: uid(), date: today(d), start_time: start, type_id: type, comment, created_by: 'm0',
    created_at: new Date().toISOString(), deleted_at: null,
    attendance: who.map((w, i) => ({ member_id: 'm' + w, sleep_time: null, won: null, ...(extra[i] ?? {}) })),
  });
  return {
    me: null, pins: {}, audit: [], tiers: [], guesses: [],
    members, eventTypes: T,
    kids: [{ id: 'k1', member_id: 'm7', name: 'Fill/a', born_on: null }],
    meetups: [
      mk(2, 't1', [0, 1, 2, 3, 6], [], null, 'Birres al Racó'),
      mk(5, 't3', [0, 2, 4, 5], [{ sleep_time: '03:10' }, { sleep_time: '01:00' }, { sleep_time: '05:30' }, { sleep_time: '23:45' }], null, 'Festa major'),
      mk(9, 't4', [1, 3, 6, 9], [{ won: true }, { won: false }, { won: true }, { won: false }]),
      mk(12, 't5', [0, 7, 8], [], '08:00', 'Sortida a Montserrat'),
      mk(20, 't6', [0, 1, 2, 3, 4, 5, 6, 7], [], null, 'Cap de setmana a la Cerdanya'),
      mk(40, 't2', [2, 3, 7, 9]),
    ],
    adjustments: [{ id: uid(), member_id: 'm4', points: -2, reason: 'Va arribar 1h tard', date: today(3), created_by: 'm0', created_at: new Date().toISOString() }],
  };
}

export class DemoApi implements Api {
  readonly demo = true;
  private s: DemoState;
  constructor() {
    let s: DemoState | null = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
    this.s = s ?? seed();
    // members removed from the roster (demo only)
    this.s.members = this.s.members.filter((m) => m.nickname !== 'Roc');
    // add members introduced after this browser's demo data was created
    for (const m of seed().members) if (!this.s.members.some((x) => x.nickname === m.nickname)) this.s.members.push({ ...m, id: 'm' + this.s.members.length, sort_order: this.s.members.length });
    // fill in faces provided at load time (demo build), without touching ones set in the app
    const avatars: Record<string, string> = (window as any).__DEMO_AVATARS ?? {};
    for (const m of this.s.members) if (avatars[m.nickname]) m.avatar_data = avatars[m.nickname];
  }
  private save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch { /* ignore */ }
  }
  private log(entity: string, entity_id: string, action: AuditEntry['action'], before: any, after: any) {
    this.s.audit.unshift({ id: this.s.audit.length + 1, at: new Date().toISOString(), actor_id: this.s.me, entity, entity_id, action, before, after });
  }
  private isAdmin() { return this.s.members.find((m) => m.id === this.s.me)?.role === 'admin'; }
  private need(cond: boolean, code = 'no_permis') { if (!cond) throw new Error(code); }

  async init() { return this.s.me; }
  async roster() {
    return this.s.members.filter((m) => m.active).map((m) => ({ id: m.id, nickname: m.nickname, avatar_data: m.avatar_data, has_pin: !!this.s.pins[m.id] }));
  }
  async join(_code: string, memberId: string, pin: string) {
    this.need(/^\d{4}$/.test(pin), 'pin_invalid');
    if (this.s.pins[memberId]) this.need(this.s.pins[memberId] === pin, 'pin_incorrecte');
    else this.s.pins[memberId] = pin;
    this.s.me = memberId; this.save(); return memberId;
  }
  async leave() { this.s.me = null; this.save(); }

  async loadAll(): Promise<AppData> {
    const c = structuredClone(this.s);
    return { members: c.members, kids: c.kids, eventTypes: c.eventTypes, meetups: c.meetups.filter((m) => !m.deleted_at), adjustments: c.adjustments };
  }
  async saveMeetup(m: MeetupDraft, attendance: Attendance[]) {
    if (m.id) {
      const cur = this.s.meetups.find((x) => x.id === m.id)!;
      this.need(this.isAdmin() || cur.created_by === this.s.me);
      const before = structuredClone(cur);
      Object.assign(cur, { date: m.date, start_time: m.start_time, type_id: m.type_id, comment: m.comment, attendance });
      this.log('att_meetups', cur.id, 'update', before, cur);
    } else {
      const row = { ...m, id: uid(), created_by: this.s.me, created_at: new Date().toISOString(), deleted_at: null, attendance } as any;
      this.s.meetups.unshift(row); this.log('att_meetups', row.id, 'insert', null, row);
    }
    this.s.meetups.sort((a, b) => b.date.localeCompare(a.date)); this.save();
  }
  async deleteMeetup(id: string) {
    const cur = this.s.meetups.find((x) => x.id === id)!;
    this.need(this.isAdmin() || cur.created_by === this.s.me);
    cur.deleted_at = new Date().toISOString(); this.log('att_meetups', id, 'update', null, cur); this.save();
  }
  async addAdjustment(a: any) {
    const row = { ...a, id: uid(), created_by: this.s.me, created_at: new Date().toISOString() };
    this.s.adjustments.unshift(row); this.log('att_adjustments', row.id, 'insert', null, row); this.save();
  }
  async deleteAdjustment(id: string) {
    const cur = this.s.adjustments.find((x) => x.id === id)!;
    this.need(this.isAdmin() || cur.created_by === this.s.me);
    this.s.adjustments = this.s.adjustments.filter((x) => x.id !== id); this.log('att_adjustments', id, 'delete', cur, null); this.save();
  }
  async audit(limit: number) { return this.s.audit.slice(0, limit); }

  private upsert(list: any[], row: any, entity: string) {
    this.need(this.isAdmin(), 'nomes_admin');
    if (row.id) { const cur = list.find((x) => x.id === row.id); const before = { ...cur }; Object.assign(cur, row); this.log(entity, row.id, 'update', before, cur); }
    else { const r = { active: true, sort_order: list.length, ...row, id: uid() }; list.push(r); this.log(entity, r.id, 'insert', null, r); }
    this.save();
  }
  async saveMember(m: any) { this.upsert(this.s.members, { role: 'member', avatar_data: null, real_name: null, ...m }, 'members'); }
  async saveKid(k: any) { this.upsert(this.s.kids, k, 'member_kids'); }
  async deleteKid(id: string) { this.need(this.isAdmin(), 'nomes_admin'); this.s.kids = this.s.kids.filter((k) => k.id !== id); this.save(); }
  async saveEventType(t: any) { this.upsert(this.s.eventTypes, t, 'att_event_types'); }
  async resetPin(memberId: string) { this.need(this.isAdmin(), 'nomes_admin'); delete this.s.pins[memberId]; this.save(); }
  async setGroupCode() { this.need(this.isAdmin(), 'nomes_admin'); }

  async tierGames(): Promise<TierGame[]> {
    return this.s.tiers.map((t) => {
      const mine = this.s.guesses.find((g) => g.game_id === t.id && g.member_id === this.s.me);
      const all = this.s.guesses.filter((g) => g.game_id === t.id);
      const see = t.creator_id === this.s.me || !!mine;
      return {
        id: t.id, placements: t.placements, candidates: t.candidates, created_at: t.created_at,
        is_creator: t.creator_id === this.s.me, my_category: mine?.category_index ?? null, my_creator_guess: mine?.creator_guess_id ?? null,
        real_index: see ? t.real_index : null, creator_id: see ? t.creator_id : null,
        guesses: all.length, correct: all.filter((g) => g.correct_category).length,
      };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async tierCreate(placements: any, categories: string[], realIndex: number) {
    this.need(categories.length >= 3 && categories.length <= 5, 'cal_3_a_5_categories');
    const order = categories.map((_, i) => i).sort(() => Math.random() - 0.5);
    const id = uid();
    this.s.tiers.push({ id, placements, candidates: order.map((i) => categories[i].trim()), created_at: new Date().toISOString(), creator_id: this.s.me!, real_index: order.indexOf(realIndex) });
    this.save(); return id;
  }
  async tierGuess(gameId: string, category: number, creatorId: string | null) {
    const t = this.s.tiers.find((x) => x.id === gameId)!;
    this.need(t.creator_id !== this.s.me, 'ets_el_creador');
    this.need(!this.s.guesses.some((g) => g.game_id === gameId && g.member_id === this.s.me), 'ja_has_votat');
    const r = { real_index: t.real_index, creator_id: t.creator_id, correct_category: category === t.real_index, correct_creator: creatorId === t.creator_id };
    this.s.guesses.push({ game_id: gameId, member_id: this.s.me!, category_index: category, creator_guess_id: creatorId, correct_category: r.correct_category, correct_creator: r.correct_creator });
    this.save(); return r;
  }
  async tierLeaderboard() {
    return this.s.members.filter((m) => m.active).map((m) => {
      const g = this.s.guesses.filter((x) => x.member_id === m.id);
      const created = this.s.tiers.filter((t) => t.creator_id === m.id);
      let pts = g.reduce((s, x) => s + (x.correct_category ? 3 : 0) + (x.correct_creator ? 2 : 0), 0);
      for (const t of created) {
        const gs = this.s.guesses.filter((x) => x.game_id === t.id); const ok = gs.filter((x) => x.correct_category).length;
        if (gs.length > 0 && ok > 0 && ok < gs.length) pts += 3;
      }
      return { member_id: m.id, points: pts, games_played: g.length, games_created: created.length };
    });
  }
  async tierDelete(gameId: string) {
    const t = this.s.tiers.find((x) => x.id === gameId)!;
    this.need(this.isAdmin() || t.creator_id === this.s.me);
    this.s.tiers = this.s.tiers.filter((x) => x.id !== gameId); this.s.guesses = this.s.guesses.filter((g) => g.game_id !== gameId); this.save();
  }

  private get nm() { return (this.s.nm ??= []); }
  private get nmPlays() { return (this.s.nmPlays ??= []); }
  async nmMatches(): Promise<NmMatch[]> {
    return this.nm.map((m) => {
      const p = this.nmPlays.find((x) => x.match_id === m.id && x.member_id === this.s.me);
      const see = m.creator_id === this.s.me || !!p?.finished;
      const fin = this.nmPlays.filter((x) => x.match_id === m.id && x.finished);
      return { id: m.id, items: m.items, created_at: m.created_at, is_creator: m.creator_id === this.s.me,
        creator_id: see ? m.creator_id : null, my_answers: p?.answers ?? null, my_finished: !!p?.finished, my_lost_at: p?.lost_at ?? null,
        creator_answers: see ? m.answers : null, players: fin.length, winners: fin.filter((x) => x.lost_at === null).length };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async nmCreate(items: NmMatch['items'], answers: number[]) {
    this.need(answers.length === items.length, 'respostes_incompletes');
    const id = uid(); this.nm.push({ id, items, answers, creator_id: this.s.me!, created_at: new Date().toISOString() }); this.save(); return id;
  }
  async nmAnswer(matchId: string, q: number, option: number) {
    const m = this.nm.find((x) => x.id === matchId); this.need(!!m, 'joc_desconegut');
    this.need(m!.creator_id !== this.s.me, 'ets_el_creador');
    let p = this.nmPlays.find((x) => x.match_id === matchId && x.member_id === this.s.me);
    if (!p) { p = { match_id: matchId, member_id: this.s.me!, answers: [], lost_at: null, finished: false }; this.nmPlays.push(p); }
    this.need(!p.finished, 'ja_has_votat'); this.need(q === p.answers.length, 'ordre_incorrecte');
    const same = m!.answers[q] === option, last = q + 1 === m!.answers.length;
    p.answers.push(option); if (same) p.lost_at = q; p.finished = same || last; this.save();
    return { same, creator_option: m!.answers[q], done: p.finished, won: !same && last };
  }
  async nmResults(matchId: string) {
    const m = this.nm.find((x) => x.id === matchId)!;
    const me = this.nmPlays.find((x) => x.match_id === matchId && x.member_id === this.s.me);
    if (!(m.creator_id === this.s.me || me?.finished)) return [];
    return this.nmPlays.filter((x) => x.match_id === matchId && x.finished);
  }
  async nmLeaderboard() {
    return this.s.members.filter((m) => m.active).map((m) => {
      const pl = this.nmPlays.filter((x) => x.member_id === m.id && x.finished);
      const wins = pl.filter((x) => x.lost_at === null).length;
      const trapped = this.nmPlays.filter((x) => x.finished && x.lost_at !== null && this.nm.find((n) => n.id === x.match_id)?.creator_id === m.id).length;
      return { member_id: m.id, points: wins * 3 + trapped, wins, played: pl.length, trapped };
    });
  }
  async nmDelete(matchId: string) {
    const m = this.nm.find((x) => x.id === matchId)!; this.need(this.isAdmin() || m.creator_id === this.s.me);
    this.s.nm = this.nm.filter((x) => x.id !== matchId); this.s.nmPlays = this.nmPlays.filter((x) => x.match_id !== matchId); this.save();
  }
}
