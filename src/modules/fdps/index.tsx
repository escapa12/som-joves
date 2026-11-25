import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ModuleDef } from '../../core/registry';
import { api, getState, isAdmin, memberById, toast, useStore } from '../../core/store';
import { humanError } from '../../core/api';
import { go, href } from '../../core/router';
import type { FsRank, FsVote } from '../../core/types';
import { Avatar, Empty, Header, Segmented, Sheet, fmtDate, useConfirm } from '../../ui/components';
import { madridToday, periodFrom, type Period } from './period';

// Fill de puta o Subnormal: once per day you give every other member 0–10 of each. Votes are public.
// % = average points received / 10.

export const FDP = { emoji: '😈', name: 'Fill de puta' } as const;
export const SUB = { emoji: '🤪', name: 'Subnormal' } as const;
type Kind = 'fdp' | 'sub';
// ── current leaders (all-time): their face becomes the category icon ──
let leaders: { meId: string | null; fdp: string | null; sub: string | null } | null = null;
const leaderListeners = new Set<() => void>();
export function pickLeader(rows: FsRank[], k: 'fdp_pct' | 'sub_pct'): string | null {
  const r = rows.filter((x) => x[k] !== null && x.votes > 0).sort((a, b) => (b[k]! - a[k]!) || (b.votes - a.votes));
  return r[0]?.member_id ?? null;
}
async function loadLeaders() {
  const meId = getState().meId;
  try { const rows = meId ? await api.fsRanking(null) : []; leaders = { meId, fdp: pickLeader(rows, 'fdp_pct'), sub: pickLeader(rows, 'sub_pct') }; }
  catch { leaders = { meId, fdp: null, sub: null }; }
  leaderListeners.forEach((f) => f());
}
function useLeaders() {
  const [, f] = useState(0);
  const { meId } = useStore();
  const stale = !leaders || leaders.meId !== meId;
  useEffect(() => {
    const l = () => f((x) => x + 1);
    leaderListeners.add(l);
    if (stale) loadLeaders();
    return () => { leaderListeners.delete(l); };
  }, [meId, stale]);
  return stale ? { fdp: null, sub: null } : leaders!;
}

/** Category icon: the current leader's face with a small emoji badge (emoji alone if nobody has votes yet). */
export function KindIcon({ kind, size = 22 }: { kind: Kind; size?: number }) {
  const l = useLeaders();
  const k = kind === 'fdp' ? FDP : SUB;
  const m = memberById(l[kind]);
  if (!m) return <span class={'fs-icon emoji-only'} style={{ fontSize: size * 0.9 + 'px' }} title={k.name}>{k.emoji}</span>;
  return (
    <span class="fs-icon" style={{ width: size + 'px', height: size + 'px' }} title={`${k.name}: ${m.nickname}`}>
      <Avatar m={m} size={size} />
      <span class="fs-icon-badge" style={{ fontSize: Math.max(10, size * 0.42) + 'px' }}>{k.emoji}</span>
    </span>
  );
}

// ── today's votes I've cast (shared cache, for the home badge + vote screen) ──
let mine: { meId: string | null; day: string; votes: FsVote[] } | null = null;
const listeners = new Set<() => void>();
async function loadMine() {
  const meId = getState().meId, day = madridToday();
  try { mine = { meId, day, votes: meId ? await api.fsVotes({ day, voter: meId }) : [] }; } catch { mine = { meId, day, votes: [] }; }
  listeners.forEach((f) => f());
}
function useMyToday(): FsVote[] | null {
  const [, f] = useState(0);
  const { meId } = useStore();
  const stale = !mine || mine.meId !== meId || mine.day !== madridToday();
  useEffect(() => {
    const l = () => f((x) => x + 1);
    listeners.add(l);
    if (stale) loadMine();
    return () => { listeners.delete(l); };
  }, [meId, stale]);
  return stale ? null : mine!.votes;
}

const pct = (n: number | null) => (n === null ? '–' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);

function Score({ kind, v }: { kind: Kind; v: number }) {
  const k = kind === 'fdp' ? FDP : SUB;
  return <span class={'fs-score ' + kind} title={k.name}><KindIcon kind={kind} size={18} /> {v}</span>;
}

/** One bar: left = % subnormal, right = % fill de puta (same sides as the vote scale) (they always add up to 100). */
function SplitBar({ fdp }: { fdp: number }) {
  const sub = Math.round((100 - fdp) * 10) / 10;
  return (
    <div class="fs-split">
      <span class="fs-split-end" title={SUB.name}><span>{SUB.emoji}</span><b>{pct(sub)}</b></span>
      <div class="fs-split-bar"><div class="s" style={{ width: `${sub}%` }} /><div class="f" style={{ width: `${fdp}%` }} /></div>
      <span class="fs-split-end r" title={FDP.name}><b>{pct(fdp)}</b><span>{FDP.emoji}</span></span>
    </div>
  );
}

// ───────────────────────── Ranking (home) ─────────────────────────
function Ranking() {
  const { data, meId } = useStore();
  const [kind, setKind] = useState<Kind>('fdp'); // sort order: most FdP first or most subnormal first
  const [period, setPeriod] = useState<Period>('sempre');
  const [rows, setRows] = useState<FsRank[] | null>(null);
  const [today, setToday] = useState<FsVote[] | null>(null);
  const myToday = useMyToday();
  useEffect(() => { setRows(null); api.fsRanking(periodFrom(period)).then(setRows).catch((e) => { toast(humanError(e), 'err'); setRows([]); }); }, [period]);
  useEffect(() => { loadMine(); loadLeaders(); api.fsVotes({ day: madridToday(), limit: 200 }).then(setToday).catch(() => setToday([])); }, []);

  const others = data.members.filter((m) => m.active && m.id !== meId);
  const pending = myToday ? others.filter((m) => !myToday.some((v) => v.target_id === m.id)).length : null;
  const key = kind === 'fdp' ? 'fdp_pct' : 'sub_pct';
  const sorted = (rows ?? []).filter((r) => r.fdp_pct !== null).sort((a, b) => (b[key]! - a[key]!) || (b.votes - a.votes));
  const unrated = (rows ?? []).filter((r) => r.fdp_pct === null);

  return (
    <div class="page">
      <Header title="Fill de puta o Subnormal" back="" />
      <a class={'card row fs-cta' + (pending === 0 ? ' done' : '')} href={href('fdps/votar')}>
        <span class="emoji">🗳️</span>
        <div class="grow">
          <strong>{pending === 0 ? 'Ja has votat tothom avui' : 'Votar'}</strong>
          <div class="small">{pending === null ? '…' : pending === 0 ? 'Torna demà per tornar a repartir 🔥' : `Et queden ${pending} persones per votar avui`}</div>
        </div>
        <span class="chev">›</span>
      </a>

      <div class="stack tight">
        <span class="muted small">Ordenar per</span>
        <Segmented<Kind> value={kind} onChange={setKind} options={[['fdp', <span class="row center small-gap"><KindIcon kind="fdp" size={22} />{FDP.name}</span>], ['sub', <span class="row center small-gap"><KindIcon kind="sub" size={22} />{SUB.name}</span>]]} />
      </div>
      <div class="chips">
        {([['mes', 'Aquest mes'], ['any', 'Aquest any'], ['sempre', 'Sempre']] as [Period, string][]).map(([p, l]) => (
          <button class={'chip' + (period === p ? ' on' : '')} onClick={() => setPeriod(p)}>{l}</button>
        ))}
      </div>

      {!rows ? <p class="muted">Carregant…</p> : sorted.length === 0 ? <Empty emoji={FDP.emoji} text="Encara no hi ha vots en aquest període." /> : (
        <section class="card stack tight">
          {sorted.map((r, i) => {
            const m = memberById(r.member_id);
            return (
              <a class="row fs-rank" href={href('fdps/p/' + r.member_id)}>
                <span class="pos">{i + 1}</span>
                <Avatar m={m} size={40} ring={i === 0} />
                <div class="grow stack tight">
                  <span class="row small-gap"><b>{m?.nickname ?? '?'}</b><span class="muted small">· {r.votes} vot{r.votes === 1 ? '' : 's'}</span></span>
                  <SplitBar fdp={r.fdp_pct!} />
                </div>
              </a>
            );
          })}
          {unrated.length > 0 && <p class="muted small" style={{ margin: 0 }}>Sense vots: {unrated.map((r) => memberById(r.member_id)?.nickname).join(', ')}</p>}
        </section>
      )}

      {today && today.length > 0 && (
        <section class="stack">
          <h3 class="section-title">Vots d'avui ({today.length})</h3>
          <VoteList votes={today} onChange={() => api.fsVotes({ day: madridToday(), limit: 200 }).then(setToday)} />
        </section>
      )}
    </div>
  );
}

function VoteList({ votes, hideTarget, onChange }: { votes: FsVote[]; hideTarget?: boolean; onChange?: () => void }) {
  const [confirm, dialog] = useConfirm();
  const del = async (v: FsVote) => {
    if (!(await confirm(`Esborrar el vot de ${memberById(v.voter_id)?.nickname} a ${memberById(v.target_id)?.nickname}?`, 'Esborrar'))) return;
    try { await api.fsDelete(v.id); toast('Vot esborrat'); await Promise.all([loadMine(), loadLeaders()]); onChange?.(); } catch (e) { toast(humanError(e), 'err'); }
  };
  return (
    <div class="card stack tight">
      {votes.map((v) => (
        <div class="row small-gap fs-vote">
          <Avatar m={memberById(v.voter_id)} size={28} />
          <span class="small grow">
            <b>{memberById(v.voter_id)?.nickname ?? '?'}</b>
            {!hideTarget && <> → <b>{memberById(v.target_id)?.nickname ?? '?'}</b></>}
            {hideTarget && <span class="muted"> · {fmtDate(v.day)}</span>}
          </span>
          <Score kind="fdp" v={v.fdp} /><Score kind="sub" v={v.sub} />
          {isAdmin() && <button class="iconbtn fs-del" aria-label="Esborrar vot" onClick={() => del(v)}>×</button>}
        </div>
      ))}
      {dialog}
    </div>
  );
}

// ───────────────────────── Vote ─────────────────────────
/** One choice 0–10: 10 = full fill de puta, 0 = full subnormal (subnormal = 10 − fill de puta). */
function Spectrum({ value, onPick }: { value: number | undefined; onPick: (n: number) => void }) {
  return (
    <div class="stack tight">
      <div class="row small-gap fs-spec-head">
        <KindIcon kind="sub" size={30} /><span class="small">{SUB.name}</span>
        <span class="grow center-text">{value === undefined ? <span class="muted small">Tria</span> : <b>{FDP.emoji} {value} · {SUB.emoji} {10 - value}</b>}</span>
        <span class="small">{FDP.name}</span><KindIcon kind="fdp" size={30} />
      </div>
      <div class="fs-scale spectrum" role="radiogroup" aria-label="De subnormal a fill de puta">
        {Array.from({ length: 11 }, (_, n) => (
          <button type="button" role="radio" aria-checked={value === n} class={value === n ? 'on' : ''} style={{ '--t': n / 10 } as any} onClick={() => onPick(n)}>{n}</button>
        ))}
      </div>
    </div>
  );
}

function Vote() {
  const { data, meId } = useStore();
  const myToday = useMyToday();
  const [who, setWho] = useState<string | null>(null);
  const [fdp, setFdp] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const others = data.members.filter((m) => m.active && m.id !== meId);
  const votedBy = new Map((myToday ?? []).map((v) => [v.target_id, v]));
  const left = others.filter((m) => !votedBy.has(m.id)).length;
  const target = memberById(who);
  const open = (id: string) => {
    if (votedBy.has(id)) return toast(`Ja has votat ${memberById(id)?.nickname} avui. Torna demà!`);
    setWho(id); setFdp(undefined);
  };
  const close = () => setWho(null);

  const send = async () => {
    if (!who || fdp === undefined) return;
    setBusy(true);
    try {
      await api.fsVote([{ target: who, fdp, sub: 10 - fdp }]);
      toast(`Vot a ${target?.nickname} enviat 🗳️`);
      close();
      await Promise.all([loadMine(), loadLeaders()]);
    } catch (e) { toast(humanError(e), 'err'); await loadMine(); }
    setBusy(false);
  };

  return (
    <div class="page">
      <Header title="Votar" back="fdps" />
      <p class="muted small" style={{ margin: 0 }}>Toca una cara i tria de 0 a 10: com més alt, més {FDP.emoji} fill de puta; com més baix, més {SUB.emoji} subnormal. Un vot per persona i dia. Els vots són públics 👀</p>
      {!myToday ? <p class="muted">Carregant…</p> : (
        <>
          <p class="small" style={{ margin: 0 }}><b>{left === 0 ? 'Ja has votat tothom avui. Torna demà! 🔥' : `Et queden ${left} de ${others.length}`}</b></p>
          <div class="avatar-grid fs-grid">
            {others.map((m) => {
              const v = votedBy.get(m.id);
              return (
                <button type="button" class={'pick' + (v ? ' voted' : ' on')} onClick={() => open(m.id)} aria-disabled={!!v} title={v ? 'Ja l\'has votat avui' : `Votar ${m.nickname}`} aria-label={v ? `${m.nickname}: ja l'has votat avui` : `Votar ${m.nickname}`}>
                  <span class="fs-face"><Avatar m={m} size={64} />{v && <span class="fs-check">✅</span>}</span>
                  <span>{m.nickname}</span>
                  {v && <span class="fs-mini">{FDP.emoji}{v.fdp} {SUB.emoji}{v.sub}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
      <Sheet open={!!target} onClose={close} title={target ? `Votar ${target.nickname}` : ''}>
        {target && (
          <div class="stack">
            <div class="row center"><Avatar m={target} size={96} /></div>
            <Spectrum value={fdp} onPick={setFdp} />
            <button class="btn primary block" disabled={busy || fdp === undefined} onClick={send}>
              {busy ? '…' : fdp === undefined ? 'Tria una nota' : 'Votar 🗳️'}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ───────────────────────── Person ─────────────────────────
function Person({ id }: { id: string }) {
  const m = memberById(id);
  const [votes, setVotes] = useState<FsVote[] | null>(null);
  const [rank, setRank] = useState<FsRank | null>(null);
  const reload = () => {
    api.fsVotes({ target: id, limit: 300 }).then(setVotes).catch(() => setVotes([]));
    api.fsRanking(null).then((r) => setRank(r.find((x) => x.member_id === id) ?? null)).catch(() => {});
  };
  useEffect(reload, [id]);
  const given = useMemo(() => votes?.length ?? 0, [votes]);
  if (!m) return <div class="page"><Header title="Fill de puta o Subnormal" back="fdps" /><p class="muted">Aquest membre no existeix.</p></div>;
  return (
    <div class="page">
      <Header title={m.nickname} back="fdps" />
      <div class="card row gap center-text">
        <Avatar m={m} size={72} />
        <div class="grow stats fs-stats">
          <div><b>{pct(rank?.fdp_pct ?? null)}</b><span class="row center small-gap"><KindIcon kind="fdp" size={20} /> fill de puta</span></div>
          <div><b>{pct(rank?.sub_pct ?? null)}</b><span class="row center small-gap"><KindIcon kind="sub" size={20} /> subnormal</span></div>
        </div>
      </div>
      <h3 class="section-title">Vots rebuts{votes ? ` (${given}${given >= 300 ? '+' : ''})` : ''}</h3>
      {!votes ? <p class="muted">Carregant…</p> : votes.length === 0 ? <Empty emoji="😇" text="Encara ningú l'ha votat." /> : <VoteList votes={votes} hideTarget onChange={reload} />}
    </div>
  );
}

function Page({ path }: { path: string[] }) {
  const [p, id] = path;
  if (p === 'votar') return <Vote />;
  if (p === 'p' && id) return <Person id={id} key={id} />;
  return <Ranking />;
}

export const fdps: ModuleDef = {
  id: 'fdps',
  title: 'Fill de puta o Subnormal',
  emoji: '😈',
  description: 'Puntua als teus amics. Qui és més retrassat?',
  Page,
};
