import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Api, MeetupDraft } from './api';
import type { AppData, Attendance, EqDay, EqQueued, EqResult, EqState, PushSub, FsVote, FsVoteDraft, FsVoteFilter, Meetup, NmMatch, TierGame } from './types';

function ok<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}

export class SupabaseApi implements Api {
  readonly demo = false;
  private sb: SupabaseClient;

  constructor(url: string, key: string) {
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  private async ensureAuth() {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) ok(await this.sb.auth.signInAnonymously());
  }

  async init() {
    await this.ensureAuth();
    return ok(await this.sb.rpc('current_member')) as string | null;
  }
  async roster(code: string) {
    await this.ensureAuth();
    const r = ok(await this.sb.rpc('roster_for_code', { p_code: code })) as any[];
    if (!r.length) throw new Error('codi_incorrecte');
    return r as any;
  }
  async join(code: string, memberId: string, pin: string) {
    await this.ensureAuth();
    const id = ok(await this.sb.rpc('join_group', { p_code: code, p_member: memberId, p_pin: pin })) as string | null;
    if (!id) throw new Error('pin_incorrecte');
    return id;
  }
  async leave() {
    ok(await this.sb.rpc('leave_group'));
  }

  async loadAll(): Promise<AppData> {
    const [members, kids, eventTypes, meetups, attendance, adjustments] = await Promise.all([
      this.sb.from('members').select('*').order('sort_order'),
      this.sb.from('member_kids').select('*'),
      this.sb.from('att_event_types').select('*').order('sort_order'),
      this.sb.from('att_meetups').select('*').is('deleted_at', null).order('date', { ascending: false }),
      this.sb.from('att_attendance').select('*'),
      this.sb.from('att_adjustments').select('*').order('date', { ascending: false }),
    ]);
    const att = ok(attendance) as (Attendance & { meetup_id: string })[];
    const byMeetup = new Map<string, Attendance[]>();
    for (const a of att) {
      if (!byMeetup.has(a.meetup_id)) byMeetup.set(a.meetup_id, []);
      byMeetup.get(a.meetup_id)!.push({ member_id: a.member_id, sleep_time: a.sleep_time, won: a.won });
    }
    return {
      members: ok(members) as any,
      kids: ok(kids) as any,
      eventTypes: ok(eventTypes) as any,
      meetups: (ok(meetups) as Meetup[]).map((m) => ({ ...m, attendance: byMeetup.get(m.id) ?? [] })),
      adjustments: (ok(adjustments) as any[]).map((a) => ({ ...a, points: Number(a.points) })),
    };
  }

  private async me() {
    return ok(await this.sb.rpc('current_member')) as string;
  }

  async saveMeetup(m: MeetupDraft, attendance: Attendance[]) {
    const row = { date: m.date, start_time: m.start_time || null, type_id: m.type_id, comment: m.comment || null };
    let id = m.id;
    if (id) {
      ok(await this.sb.from('att_meetups').update(row).eq('id', id));
      ok(await this.sb.from('att_attendance').delete().eq('meetup_id', id));
    } else {
      const ins = ok(await this.sb.from('att_meetups').insert({ ...row, created_by: await this.me() }).select('id').single()) as any;
      id = ins.id as string;
    }
    if (attendance.length)
      ok(await this.sb.from('att_attendance').insert(attendance.map((a) => ({ ...a, meetup_id: id }))));
  }
  async deleteMeetup(id: string) {
    ok(await this.sb.from('att_meetups').update({ deleted_at: new Date().toISOString() }).eq('id', id));
  }
  async addAdjustment(a: { member_id: string; points: number; reason: string; date: string }) {
    ok(await this.sb.from('att_adjustments').insert({ ...a, created_by: await this.me() }));
  }
  async deleteAdjustment(id: string) {
    ok(await this.sb.from('att_adjustments').delete().eq('id', id));
  }
  async audit(limit: number) {
    return ok(await this.sb.from('audit_log').select('*').order('id', { ascending: false }).limit(limit)) as any;
  }

  async saveMember(m: any) {
    const { id, ...rest } = m;
    if (id) ok(await this.sb.from('members').update(rest).eq('id', id));
    else ok(await this.sb.from('members').insert(rest));
  }
  async saveKid(k: any) {
    const { id, ...rest } = k;
    if (id) ok(await this.sb.from('member_kids').update(rest).eq('id', id));
    else ok(await this.sb.from('member_kids').insert(rest));
  }
  async deleteKid(id: string) {
    ok(await this.sb.from('member_kids').delete().eq('id', id));
  }
  async saveEventType(t: any) {
    const { id, ...rest } = t;
    if (id) ok(await this.sb.from('att_event_types').update(rest).eq('id', id));
    else ok(await this.sb.from('att_event_types').insert(rest));
  }
  async resetPin(memberId: string) {
    ok(await this.sb.rpc('admin_reset_pin', { p_member: memberId }));
  }
  async setGroupCode(code: string) {
    ok(await this.sb.rpc('admin_set_group_code', { p_code: code }));
  }

  async tierGames(): Promise<TierGame[]> {
    const [games, status] = await Promise.all([
      this.sb.from('tier_games').select('*').order('created_at', { ascending: false }),
      this.sb.rpc('tier_my_games'),
    ]);
    const st = new Map((ok(status) as any[]).map((s) => [s.game_id, s]));
    return (ok(games) as any[]).map((g) => {
      const s: any = st.get(g.id) ?? {};
      return {
        ...g,
        is_creator: !!s.is_creator,
        my_category: s.my_category ?? null,
        my_creator_guess: s.my_creator_guess ?? null,
        real_index: s.real_index ?? null,
        creator_id: s.creator_id ?? null,
        guesses: s.guesses ?? 0,
        correct: s.correct ?? 0,
      };
    });
  }
  async tierCreate(placements: any, categories: string[], realIndex: number) {
    return ok(await this.sb.rpc('tier_create', { p_placements: placements, p_categories: categories, p_real_index: realIndex })) as string;
  }
  async tierGuess(gameId: string, category: number, creatorId: string | null) {
    const r = ok(await this.sb.rpc('tier_guess', { p_game: gameId, p_category: category, p_creator: creatorId })) as any[];
    return r[0];
  }
  async tierLeaderboard() {
    return ok(await this.sb.rpc('tier_leaderboard')) as any;
  }
  async tierDelete(gameId: string) {
    ok(await this.sb.rpc('tier_delete', { p_game: gameId }));
  }

  async nmMatches(): Promise<NmMatch[]> {
    const [matches, status] = await Promise.all([
      this.sb.from('nm_matches').select('*').order('created_at', { ascending: false }),
      this.sb.rpc('nm_my_matches'),
    ]);
    const st = new Map((ok(status) as any[]).map((s) => [s.match_id, s]));
    return (ok(matches) as any[]).map((m) => {
      const s: any = st.get(m.id) ?? {};
      return { ...m, is_creator: !!s.is_creator, creator_id: s.creator_id ?? null, my_answers: s.my_answers ?? null,
        my_finished: !!s.my_finished, my_lost_at: s.my_lost_at ?? null, creator_answers: s.creator_answers ?? null,
        players: s.players ?? 0, winners: s.winners ?? 0 };
    });
  }
  async nmCreate(items: any, answers: number[]) {
    return ok(await this.sb.rpc('nm_create', { p_items: items, p_answers: answers })) as string;
  }
  async nmAnswer(matchId: string, q: number, option: number) {
    return (ok(await this.sb.rpc('nm_answer', { p_match: matchId, p_q: q, p_option: option })) as any[])[0];
  }
  async nmResults(matchId: string) {
    return ok(await this.sb.rpc('nm_results', { p_match: matchId })) as any;
  }
  async nmLeaderboard() {
    return ok(await this.sb.rpc('nm_leaderboard')) as any;
  }
  async nmDelete(matchId: string) {
    ok(await this.sb.rpc('nm_delete', { p_match: matchId }));
  }

  async fsRanking(from: string | null) {
    return (ok(await this.sb.rpc('fs_ranking', { p_from: from })) as any[]).map((r) => ({
      member_id: r.member_id, votes: r.votes,
      fdp_pct: r.fdp_pct === null ? null : Number(r.fdp_pct), sub_pct: r.sub_pct === null ? null : Number(r.sub_pct),
    }));
  }
  async fsVotes(f: FsVoteFilter) {
    let q = this.sb.from('fs_votes').select('*');
    if (f.day) q = q.eq('day', f.day);
    if (f.from) q = q.gte('day', f.from);
    if (f.voter) q = q.eq('voter_id', f.voter);
    if (f.target) q = q.eq('target_id', f.target);
    return ok(await q.order('created_at', { ascending: false }).limit(f.limit ?? 500)) as FsVote[];
  }
  async fsVote(votes: FsVoteDraft[]) {
    return ok(await this.sb.rpc('fs_vote', { p_votes: votes })) as number;
  }
  async fsDelete(voteId: string) {
    ok(await this.sb.rpc('fs_delete', { p_vote: voteId }));
  }

  async eqState() {
    return ok(await this.sb.rpc('eq_state')) as EqState;
  }
  async eqVote(option: number) {
    ok(await this.sb.rpc('eq_vote', { p_option: option }));
  }
  async eqResults(day: string) {
    return ok(await this.sb.rpc('eq_results', { p_day: day })) as EqResult[];
  }
  async eqHistory(limit: number) {
    return ok(await this.sb.rpc('eq_history', { p_limit: limit })) as EqDay[];
  }
  async eqQueue() {
    return ok(await this.sb.rpc('eq_queue_list')) as EqQueued[];
  }
  async eqAdd(question: string, options: string[]) {
    return ok(await this.sb.rpc('eq_add', { p_question: question, p_options: options })) as string;
  }
  async eqDelete(id: string) {
    ok(await this.sb.rpc('eq_delete', { p_id: id }));
  }
  async pushSubscribe(s: PushSub) {
    ok(await this.sb.rpc('push_subscribe', { p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth }));
  }
  async pushUnsubscribe(endpoint: string) {
    ok(await this.sb.rpc('push_unsubscribe', { p_endpoint: endpoint }));
  }
}
