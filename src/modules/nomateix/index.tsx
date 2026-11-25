import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ModuleDef } from '../../core/registry';
import { api, getState, isAdmin, memberById, toast, useStore } from '../../core/store';
import { humanError } from '../../core/api';
import { go, href } from '../../core/router';
import type { NmMatch, NmResult, NmScore } from '../../core/types';
import { Avatar, Empty, Header, useConfirm } from '../../ui/components';
import { drawMatch, questionById, randomWinChance, QUESTIONS_PER_MATCH, type MatchItem } from './questions';

// ── shared cache (per logged-in member) ──
let cache: NmMatch[] | null = null;
let cacheFor: string | null = null;
const listeners = new Set<() => void>();
async function load() {
  try { cacheFor = getState().meId; cache = await api.nmMatches(); } catch (e) { toast(humanError(e), 'err'); cache = cache ?? []; }
  listeners.forEach((f) => f());
}
function useMatches(): NmMatch[] | null {
  const [, f] = useState(0);
  const { meId } = useStore();
  if (cacheFor !== meId) cache = null;
  useEffect(() => {
    const l = () => f((x) => x + 1);
    listeners.add(l);
    if (!cache || cacheFor !== getState().meId) load();
    return () => { listeners.delete(l); };
  }, []);
  return cache;
}

const isFaces = (it: MatchItem) => !!questionById(it.q)?.faces;

function OptionLabel({ it, i }: { it: MatchItem; i: number }) {
  if (isFaces(it)) { const m = memberById(it.options[i]); return <span class="row gap"><Avatar m={m} size={36} /> {m?.nickname ?? '?'}</span>; }
  return <span>{it.options[i]}</span>;
}

function Options({ it, selected, onPick, disabled, marks }: {
  it: MatchItem; selected?: number | null; onPick?: (i: number) => void; disabled?: boolean;
  marks?: Record<number, 'right' | 'wrong' | 'them'>;
}) {
  if (isFaces(it)) return (
    <div class="nm-faces">
      {it.options.map((id, i) => (
        <button class={'nm-face' + (selected === i ? ' on' : '') + (marks?.[i] ? ' ' + marks[i] : '')} disabled={disabled} onClick={() => onPick?.(i)}>
          <Avatar m={memberById(id)} size={72} />
          <span>{memberById(id)?.nickname}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div class="nm-grid">
      {it.options.map((o, i) => (
        <button class={'option' + (selected === i ? ' on' : '') + (marks?.[i] ? ' ' + marks[i] : '')} disabled={disabled} onClick={() => onPick?.(i)}>{o}</button>
      ))}
    </div>
  );
}

function Popup({ kind, title, text, onClose }: { kind: 'lose' | 'win'; title: string; text: string; onClose: () => void }) {
  return (
    <div class="sheet-backdrop center" onClick={onClose}>
      <div class={'dialog nm-pop ' + kind}>
        <div class="big">{kind === 'lose' ? '💥' : '🎉'}</div>
        <h2>{title}</h2>
        <p>{text}</p>
        <button class="btn primary block" onClick={onClose}>D'acord</button>
      </div>
    </div>
  );
}

function Create() {
  const { data } = useStore();
  const ids = data.members.filter((m) => m.active).map((m) => m.id);
  const [items, setItems] = useState<MatchItem[]>(() => drawMatch(ids));
  const [answers, setAnswers] = useState<(number | null)[]>(() => Array(QUESTIONS_PER_MATCH).fill(null));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const it = items[step];
  const done = answers.every((a) => a !== null);
  const reroll = () => { setItems(drawMatch(ids)); setAnswers(Array(QUESTIONS_PER_MATCH).fill(null)); setStep(0); };
  const pick = (i: number) => {
    const n = [...answers]; n[step] = i; setAnswers(n);
    if (step < items.length - 1) setTimeout(() => setStep(step + 1), 220);
  };
  const publish = async () => {
    setBusy(true);
    try {
      const id = await api.nmCreate(items, answers as number[]);
      await load();
      toast('Partida creada! Que vinguin 😈');
      go('nomateix/' + id);
    } catch (e) { toast(humanError(e), 'err'); }
    setBusy(false);
  };
  return (
    <div class="page">
      <Header title="Nova partida" back="nomateix" />
      <p class="muted small">Respon les {items.length} preguntes. Després els altres hauran d'evitar dir el mateix que tu.</p>
      <div class="nm-dots">{items.map((_, i) => <button class={(i === step ? 'cur ' : '') + (answers[i] !== null ? 'done' : '')} onClick={() => setStep(i)} aria-label={`Pregunta ${i + 1}`} />)}</div>
      <div class="card stack nm-q">
        <div class="muted small">Pregunta {step + 1} de {items.length}</div>
        <h2>{questionById(it.q)?.text}</h2>
        <Options it={it} selected={answers[step]} onPick={pick} />
      </div>
      <div class="row gap">
        <button class="btn ghost" onClick={reroll}>🎲 Altres preguntes</button>
        <button class="btn primary grow" disabled={!done || busy} onClick={publish}>{busy ? '…' : done ? 'Publicar partida 🚀' : `Falten ${answers.filter((a) => a === null).length}`}</button>
      </div>
    </div>
  );
}

function ResultsTable({ m }: { m: NmMatch }) {
  const [rows, setRows] = useState<NmResult[] | null>(null);
  useEffect(() => { api.nmResults(m.id).then(setRows).catch(() => setRows([])); }, [m.id, m.players]);
  if (!m.creator_answers) return null;
  const creator = memberById(m.creator_id);
  return (
    <section class="stack">
      <h3 class="section-title">Respostes</h3>
      {m.items.map((it, qi) => (
        <div class="card stack tight">
          <strong>{qi + 1}. {questionById(it.q)?.text}</strong>
          <div class="row small-gap"><Avatar m={creator} size={26} /><span class="muted small">{creator?.nickname} (creador):</span><b><OptionLabel it={it} i={m.creator_answers![qi]} /></b></div>
          {(rows ?? []).filter((r) => r.answers[qi] !== undefined).map((r) => {
            const same = r.answers[qi] === m.creator_answers![qi];
            return (
              <div class={'row small-gap' + (same ? ' nm-same' : '')}>
                <Avatar m={memberById(r.member_id)} size={26} />
                <span class="muted small">{memberById(r.member_id)?.nickname}:</span>
                <span><OptionLabel it={it} i={r.answers[qi]} /></span>
                <span>{same ? '💥' : '✅'}</span>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function Play({ id }: { id: string }) {
  const matches = useMatches();
  const m = matches?.find((x) => x.id === id);
  const [localQ, setLocalQ] = useState(0); // absolute index of the next question after my last answer
  const [pending, setPending] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ them: number; mine: number } | null>(null);
  const [pop, setPop] = useState<{ kind: 'lose' | 'win'; title: string; text: string } | null>(null);
  const [confirm, dialog] = useConfirm();
  if (!matches) return <div class="page"><Header title="No diguis el mateix" back="nomateix" /><p class="muted">Carregant…</p></div>;
  if (!m) return <div class="page"><Header title="No diguis el mateix" back="nomateix" /><p class="muted">Aquesta partida no existeix.</p></div>;

  const answered = Math.max(m.my_answers?.length ?? 0, localQ);
  const finished = m.my_finished;
  const q = answered;
  const it = m.items[q];

  const answer = async (i: number) => {
    if (pending !== null || flash) return;
    setPending(i);
    try {
      const r = await api.nmAnswer(m.id, q, i);
      setLocalQ(q + 1);
      if (r.same) {
        setPop({ kind: 'lose', title: 'Heu dit el mateix!', text: `A la pregunta ${q + 1} heu triat el mateix. Has perdut 😭` });
      } else if (r.won) {
        setPop({ kind: 'win', title: 'Has guanyat!', text: `${m.items.length} de ${m.items.length} respostes diferents. Ets impredictible 😎` });
      } else {
        setFlash({ them: r.creator_option, mine: i });
        setTimeout(() => setFlash(null), 1300);
      }
      if (r.done) await load();
    } catch (e) { toast(humanError(e), 'err'); await load(); }
    setPending(null);
  };

  const creator = memberById(m.creator_id);
  return (
    <div class="page">
      <Header title="No diguis el mateix" back="nomateix"
        right={(m.is_creator || isAdmin()) && <button class="iconbtn" aria-label="Esborrar" onClick={async () => {
          if (await confirm('Esborrar aquesta partida i tots els resultats?', 'Esborrar')) { try { await api.nmDelete(m.id); await load(); go('nomateix'); } catch (e) { toast(humanError(e), 'err'); } }
        }}>🗑</button>} />

      {m.is_creator && (
        <div class="card stack center-text">
          <h2>És la teva partida 😈</h2>
          <p class="muted">{m.players} han jugat · {m.winners} se n'han sortit · {m.players - m.winners} han caigut</p>
        </div>
      )}

      {!m.is_creator && !finished && it && (
        <>
          <div class="nm-dots">{m.items.map((_, i) => <span class={(i === q ? 'cur ' : '') + (i < q ? 'done' : '')} />)}</div>
          <div class="card stack nm-q">
            <div class="muted small">Pregunta {q + 1} de {m.items.length} · no diguis el mateix que l'altre!</div>
            <h2>{questionById(it.q)?.text}</h2>
            <Options it={it} selected={pending} onPick={answer} disabled={pending !== null} />
          </div>
        </>
      )}
      {flash && (
        <div class="nm-flash">✅ Diferent! L'altre va dir: <b><OptionLabel it={m.items[q - 1] ?? m.items[q]} i={flash.them} /></b></div>
      )}

      {(finished || m.is_creator) && (
        <>
          {!m.is_creator && (
            <div class={'card center-text nm-final ' + (m.my_lost_at === null ? 'win' : 'lose')}>
              <div class="big">{m.my_lost_at === null ? '🎉' : '💥'}</div>
              <h2>{m.my_lost_at === null ? 'Has guanyat!' : `Has caigut a la pregunta ${m.my_lost_at + 1}`}</h2>
              {creator && <p class="row center gap"><span>La partida era de</span><Avatar m={creator} size={32} /><b>{creator.nickname}</b></p>}
            </div>
          )}
          <ResultsTable m={m} />
        </>
      )}
      {pop && <Popup {...pop} onClose={() => setPop(null)} />}
      {dialog}
    </div>
  );
}

function List() {
  const matches = useMatches();
  const [lb, setLb] = useState<NmScore[] | null>(null);
  useEffect(() => { load(); api.nmLeaderboard().then(setLb).catch(() => setLb([])); }, []);
  const g = useMemo(() => {
    const a = matches ?? [];
    return {
      todo: a.filter((x) => !x.is_creator && !x.my_finished),
      mine: a.filter((x) => x.is_creator),
      done: a.filter((x) => !x.is_creator && x.my_finished),
    };
  }, [matches]);
  const card = (m: NmMatch) => (
    <a class="card row" href={href('nomateix/' + m.id)}>
      <span class="emoji">{m.is_creator ? '😈' : m.my_finished ? (m.my_lost_at === null ? '🎉' : '💥') : (m.my_answers?.length ? '⏳' : '🙊')}</span>
      <div class="grow">
        <strong>{m.items.slice(0, 2).map((it) => questionById(it.q)?.text).join(' · ')}…</strong>
        <div class="muted small">{new Date(m.created_at).toLocaleDateString('ca-ES')} · {m.players} jugades · {m.winners} guanyades
          {!m.is_creator && !m.my_finished && m.my_answers?.length ? ` · vas per la ${m.my_answers.length + 1}a` : ''}</div>
      </div>
      <span class="chev">›</span>
    </a>
  );
  const sorted = (lb ?? []).filter((s) => s.played + s.trapped > 0).sort((a, b) => b.points - a.points);
  return (
    <div class="page has-fab">
      <Header title="No diguis el mateix" back="" />
      <div class="card stack tight">
        <p class="small" style={{ margin: 0 }}>Algú respon {QUESTIONS_PER_MATCH} preguntes absurdes. Els altres responen les mateixes, una a una: <b>si coincideixes amb ell, perds</b> 💥. Si les {QUESTIONS_PER_MATCH} són diferents, guanyes.</p>
        <p class="muted small" style={{ margin: 0 }}>Responent a l'atzar guanyaries un {Math.round(randomWinChance() * 100)}% de les vegades. Pensa com pensa l'altre 🧠</p>
      </div>
      {!matches ? <p class="muted">Carregant…</p> : matches.length === 0 ? <Empty emoji="🙊" text="Encara no hi ha partides. Crea la primera!" /> : (<>
        {g.todo.length > 0 && <><h3 class="section-title">🙊 Per jugar ({g.todo.length})</h3>{g.todo.map(card)}</>}
        {g.mine.length > 0 && <><h3 class="section-title">😈 Les meves</h3>{g.mine.map(card)}</>}
        {g.done.length > 0 && <><h3 class="section-title">✔️ Jugades</h3>{g.done.map(card)}</>}
      </>)}
      {sorted.length > 0 && (
        <section class="card stack">
          <h3>🏅 Classificació</h3>
          <p class="muted small" style={{ margin: 0 }}>+3 per partida guanyada · +1 per cada amic que cau a la teva</p>
          {sorted.map((s, i) => (
            <div class="row"><span class="pos">{i + 1}</span><Avatar m={memberById(s.member_id)} size={32} />
              <span class="grow">{memberById(s.member_id)?.nickname} <span class="muted small">· {s.wins}/{s.played} guanyades, {s.trapped} caçats</span></span><b>{s.points}</b></div>
          ))}
        </section>
      )}
      <a class="fab" href={href('nomateix/nova')}>＋ Nova partida</a>
    </div>
  );
}

function Page({ path }: { path: string[] }) {
  const [p] = path;
  if (p === 'nova') return <Create />;
  if (p) return <Play id={p} key={p} />;
  return <List />;
}

export const nomateix: ModuleDef = {
  id: 'nomateix',
  title: 'No diguis el mateix',
  emoji: '🙊',
  description: '5 preguntes absurdes. Si coincideixes amb l\'altre, perds.',
  Page,
  useBadge: () => {
    const m = useMatches();
    const n = m?.filter((x) => !x.is_creator && !x.my_finished).length ?? 0;
    return n ? `${n} per jugar` : null;
  },
};
