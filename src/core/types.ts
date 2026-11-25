export type Role = 'admin' | 'member';

export interface Member {
  id: string;
  nickname: string;
  real_name: string | null;
  avatar_data: string | null;
  role: Role;
  active: boolean;
  sort_order: number;
}

export interface Kid {
  id: string;
  member_id: string;
  name: string | null;
  born_on: string | null; // YYYY-MM-DD, null = always counts
}

export type Rule =
  | { kind: 'fixed'; points: number }
  | { kind: 'sleep_hours'; per_hour: number }
  | { kind: 'win'; points: number }
  | { kind: 'meet_time'; cutoff: string; early: number; late: number };

export interface EventType {
  id: string;
  name: string;
  emoji: string;
  rule: Rule;
  active: boolean;
  sort_order: number;
}

export interface Attendance {
  member_id: string;
  sleep_time: string | null; // HH:MM[:SS]
  won: boolean | null;
}

export interface Meetup {
  id: string;
  date: string; // YYYY-MM-DD
  start_time: string | null;
  type_id: string;
  comment: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  attendance: Attendance[];
}

export interface Adjustment {
  id: string;
  member_id: string;
  points: number;
  reason: string;
  date: string;
  created_by: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_id: string | null;
  entity: string;
  entity_id: string | null;
  action: 'insert' | 'update' | 'delete';
  before: any;
  after: any;
}

export const TIERS = ['S', 'A', 'B', 'C', 'D', 'E'] as const;
export type Tier = (typeof TIERS)[number];
export type Placements = Record<Tier, string[]>;

export interface TierGame {
  id: string;
  placements: Placements;
  candidates: string[];
  created_at: string;
  // my status (from tier_my_games)
  is_creator: boolean;
  my_category: number | null;
  my_creator_guess: string | null;
  real_index: number | null; // only when I'm creator or I've guessed
  creator_id: string | null; // idem
  guesses: number;
  correct: number;
}

export interface TierScore {
  member_id: string;
  points: number;
  games_played: number;
  games_created: number;
}

export interface GuessResult {
  real_index: number;
  creator_id: string;
  correct_category: boolean;
  correct_creator: boolean;
}

export interface RosterEntry {
  id: string;
  nickname: string;
  avatar_data: string | null;
  has_pin: boolean;
}

export interface AppData {
  members: Member[];
  kids: Kid[];
  eventTypes: EventType[];
  meetups: Meetup[];
  adjustments: Adjustment[];
}

export interface NmMatch {
  id: string;
  items: { q: string; options: string[] }[];
  created_at: string;
  is_creator: boolean;
  creator_id: string | null;      // only when I'm creator or finished
  my_answers: number[] | null;
  my_finished: boolean;
  my_lost_at: number | null;
  creator_answers: number[] | null; // only when I'm creator or finished
  players: number;
  winners: number;
}
export interface NmAnswer { same: boolean; creator_option: number; done: boolean; won: boolean }
export interface NmResult { member_id: string; answers: number[]; lost_at: number | null; finished: boolean }
export interface NmScore { member_id: string; points: number; wins: number; played: number; trapped: number }

export interface FsVote { id: string; day: string; voter_id: string; target_id: string; fdp: number; sub: number; created_at: string }
export interface FsRank { member_id: string; fdp_pct: number | null; sub_pct: number | null; votes: number }
export interface FsVoteDraft { target: string; fdp: number; sub: number }
export interface FsVoteFilter { day?: string; voter?: string; target?: string; from?: string; limit?: number }

// Enquesta del dia
export interface EqState { day: string; question: string; options: string[]; author_id: string | null; my_vote: number | null; answers: number; pending: number }
export interface EqResult { member_id: string; option: number }
export interface EqDay { day: string; question: string; options: string[]; author_id: string | null; counts: number[]; my_vote: number | null }
export interface EqQueued { id: string; author_id: string; question: string; options: string[]; created_at: string; queue_pos: number }
export interface PushSub { endpoint: string; p256dh: string; auth: string }
