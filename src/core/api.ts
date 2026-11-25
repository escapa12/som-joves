import type {
  Adjustment, AppData, AuditEntry, Attendance, EventType, GuessResult, Kid, Meetup, Member,
  Placements, RosterEntry, TierGame, TierScore, NmMatch, NmAnswer, NmResult, NmScore,
} from './types';

export type MeetupDraft = Omit<Meetup, 'id' | 'created_at' | 'created_by' | 'deleted_at' | 'attendance'> & { id?: string };

export interface Api {
  readonly demo: boolean;
  /** Returns the member id bound to this device, or null. */
  init(): Promise<string | null>;
  roster(code: string): Promise<RosterEntry[]>;
  join(code: string, memberId: string, pin: string): Promise<string>;
  leave(): Promise<void>;

  loadAll(): Promise<AppData>;
  saveMeetup(m: MeetupDraft, attendance: Attendance[]): Promise<void>;
  deleteMeetup(id: string): Promise<void>;
  addAdjustment(a: Pick<Adjustment, 'member_id' | 'points' | 'reason' | 'date'>): Promise<void>;
  deleteAdjustment(id: string): Promise<void>;
  audit(limit: number): Promise<AuditEntry[]>;

  // admin
  saveMember(m: Partial<Member> & { nickname: string }): Promise<void>;
  saveKid(k: Partial<Kid> & { member_id: string }): Promise<void>;
  deleteKid(id: string): Promise<void>;
  saveEventType(t: Partial<EventType> & { name: string }): Promise<void>;
  resetPin(memberId: string): Promise<void>;
  setGroupCode(code: string): Promise<void>;

  // tiers
  tierGames(): Promise<TierGame[]>;
  tierCreate(placements: Placements, categories: string[], realIndex: number): Promise<string>;
  tierGuess(gameId: string, category: number, creatorId: string | null): Promise<GuessResult>;
  tierLeaderboard(): Promise<TierScore[]>;
  tierDelete(gameId: string): Promise<void>;

  // no diguis el mateix
  nmMatches(): Promise<NmMatch[]>;
  nmCreate(items: NmMatch['items'], answers: number[]): Promise<string>;
  nmAnswer(matchId: string, q: number, option: number): Promise<NmAnswer>;
  nmResults(matchId: string): Promise<NmResult[]>;
  nmLeaderboard(): Promise<NmScore[]>;
  nmDelete(matchId: string): Promise<void>;
}

const MSG: Record<string, string> = {
  codi_incorrecte: 'Codi del grup incorrecte.',
  pin_incorrecte: 'PIN incorrecte.',
  massa_intents: 'Massa intents. Espera 15 minuts o demana a l\'admin que et reiniciï el PIN.',
  pin_invalid: 'El PIN ha de tenir 4 xifres.',
  membre_desconegut: 'Aquest membre no existeix.',
  nomes_admin: 'Només l\'admin pot fer això.',
  ets_el_creador: 'No pots endevinar la teva pròpia llista 😅',
  ja_has_votat: 'Ja hi has jugat.',
  cal_3_a_5_categories: 'Calen entre 3 i 5 categories.',
  no_membre: 'Primer has d\'entrar al grup.',
  no_permis: 'No tens permís per fer això.',
  ordre_incorrecte: 'Respon les preguntes en ordre.',
  respostes_incompletes: 'Respon totes les preguntes.',
  joc_desconegut: 'Aquesta partida ja no existeix.',
};

export function humanError(e: unknown): string {
  const raw = (e as any)?.message ?? String(e);
  for (const k of Object.keys(MSG)) if (raw.includes(k)) return MSG[k];
  if (/row-level security|permission denied/i.test(raw)) return 'No tens permís per fer això.';
  if (/fetch|network/i.test(raw)) return 'Sense connexió. Torna-ho a provar.';
  return 'Alguna cosa ha fallat: ' + raw;
}
