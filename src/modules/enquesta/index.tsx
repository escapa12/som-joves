import { useEffect, useState } from 'preact/hooks';
import type { ModuleDef } from '../../core/registry';
import { api, getState, isAdmin, memberById, toast, useStore } from '../../core/store';
import { humanError } from '../../core/api';
import { go, href } from '../../core/router';
import { disablePush, enablePush, usePushStatus } from '../../core/push';
import type { EqDay, EqQueued, EqResult, EqState } from '../../core/types';
import { Avatar, Empty, Header, fmtDate, useConfirm } from '../../ui/components';
import { tally, whenLabel } from './logic';

// Enquesta del dia: one 4-option question per day for everyone. Members queue their own questions
// (oldest first); if the queue is empty a house question is used. Answers are public once you've answered.

const LETTERS = ['A', 'B', 'C', 'D'];

// ── today's state (shared cache: home badge + page) ──
let cache: { meId: string | null; st: EqState } | null = null;
const listeners = new Set<() => void>();
async function loadState() {
  const meId = getState().meId;
  if (!meId) return;
  try { cache = { meId, st: await api.eqState() }; } catch (e) { toast(humanError(e), 'err'); }
  listeners.forEach((f) => f());
}
function useEqState(): EqState | null {
  const [, f] = useState(0);
  const { meId } = useStore();
  const stale = !cache || cache.meId !== meId;
  useEffect(() => {
    const l = () => f((x) => x + 1);
    listeners.add(l);
    loadState();
    return () => { listeners.delete(l); };
  }, [meId]);
  return stale ? null : cache!.st;
}

function Author({ id }: { id: string | null }) {
  const m = memberById(id);
  if (!m) return <span class="muted small">🎲 Pregunta de la casa</span>;
  return <span class="row small-gap muted small"><Avatar m={m} size={22} /> Pregunta de <b>{m.nickname}</b></span>;
}

const COLORS = ['#ffcc33', '#5be3a8', '#6aa8ff', '#ff7eb6'];

/** Pie (donut) with one slice per option; hover/tap a slice or a legend row to see who picked it. */
function Results({ options, votes, mine }: { options: string[]; votes: EqResult[]; mine: number | null }) {
  const t = tally(votes);
  const [sel, setSel] = useState<number | null>(mine);
  let acc = 0;
  const shown = sel ?? -1;
  return (
    <div class="stack eq-pie-wrap">
      <div class="eq-pie" onMouseLeave={() => setSel(mine)}>
        <svg viewBox="0 0 42 42" role="img" aria-label="Resultats">
          <circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--card2)" stroke-width="7" />
          {t.total > 0 && t.counts.map((n, i) => {
            const frac = (n * 100) / t.total;
            const off = 25 - acc; acc += frac;
            if (!n) return null;
            return (
              <circle cx="21" cy="21" r="15.915" fill="none" stroke={COLORS[i]} stroke-width={shown === i ? 9 : 7}
                stroke-dasharray={`${frac} ${100 - frac}`} stroke-dashoffset={off} class={'eq-slice' + (shown >= 0 && shown !== i ? ' dim' : '')}
                onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} />
            );
          })}
        </svg>
        <div class="eq-pie-center">
          {shown >= 0 ? <><b>{t.pct[shown]}%</b><span class="small muted eq-pie-label">{options[shown]}</span></> : <><b>{t.total}</b><span class="small muted">resp.</span></>}
        </div>
      </div>
      <div class="stack tight">
        {options.map((o, i) => (
          <button type="button" class={'eq-leg' + (shown === i ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => setSel(i)}>
            <span class="eq-dot" style={{ background: COLORS[i] }} />
            <span class="grow">{o}{mine === i && <span class="muted small"> · tu</span>}{t.winners.includes(i) && ' 🏆'}</span>
            <b>{t.pct[i]}%</b>
          </button>
        ))}
      </div>
      <div class="eq-who">
        {shown < 0 ? <span class="muted small">Toca una opció per veure qui l'ha triat</span>
          : t.by[shown].length === 0 ? <span class="muted small">Ningú ha triat «{options[shown]}»</span>
          : <div class="row wrap small-gap">{t.by[shown].map((id) => <span class="row eq-voter"><Avatar m={memberById(id)} size={26} /><span class="small">{memberById(id)?.nickname ?? '?'}</span></span>)}</div>}
      </div>
      <p class="muted small" style={{ margin: 0 }}>{t.total} {t.total === 1 ? 'resposta' : 'respostes'}</p>
    </div>
  );
}

function PushCard() {
  const [st, reload] = usePushStatus();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); } catch (e) { toast(humanError(e), 'err'); }
    setBusy(false); reload();
  };
  if (st === 'loading') return null;
  if (st === 'on') return (
    <div class="row small-gap muted small">
      <span class="grow">🔔 Notificacions activades (9:00 i 20:00)</span>
      <button class="btn ghost small" disabled={busy} onClick={() => run(disablePush, 'Notificacions desactivades')}>Desactivar</button>
    </div>
  );
  return (
    <div class="card stack tight eq-push">
      <strong>🔔 Vols que t'avisem?</strong>
      <span class="small muted">Cada dia a les 9:00 amb la pregunta nova, i a les 20:00 si encara no has respost.</span>
      {st === 'off' && <button class="btn primary" disabled={busy} onClick={() => run(enablePush, 'Notificacions activades 🔔')}>{busy ? '…' : 'Activar notificacions'}</button>}
      {st === 'ios-install' && <span class="small">A l'iPhone primer has d'afegir l'app a la pantalla d'inici: a Safari, botó <b>Compartir</b> → <b>Afegir a la pantalla d'inici</b>. Obre-la des d'allà i activa-les aquí.</span>}
      {st === 'denied' && <span class="small">Les tens bloquejades. Activa-les a la configuració del navegador per a aquesta web.</span>}
      {st === 'unsupported' && <span class="small">Aquest navegador no permet notificacions.</span>}
    </div>
  );
}

// ───────────────────────── Today ─────────────────────────
function Today() {
  const st = useEqState();
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [votes, setVotes] = useState<EqResult[] | null>(null);
  const [queue, setQueue] = useState<EqQueued[] | null>(null);
  const [hist, setHist] = useState<EqDay[] | null>(null);
  const [confirm, dialog] = useConfirm();
  const answered = st?.my_vote !== null && st?.my_vote !== undefined;

  useEffect(() => { if (st && answered) api.eqResults(st.day).then(setVotes).catch(() => setVotes([])); }, [st?.day, answered]);
  const loadQueue = () => api.eqQueue().then(setQueue).catch(() => setQueue([]));
  useEffect(() => { loadQueue(); api.eqHistory(30).then(setHist).catch(() => setHist([])); }, []);

  const send = async () => {
    if (pick === null) return;
    setBusy(true);
    try { await api.eqVote(pick); toast('Resposta enviada 🗳️'); } catch (e) { toast(humanError(e), 'err'); }
    await loadState(); setBusy(false);
  };
  const del = async (q: EqQueued) => {
    if (!(await confirm(`Treure "${q.question}" de la cua?`, 'Treure'))) return;
    try { await api.eqDelete(q.id); toast('Pregunta treta de la cua'); } catch (e) { toast(humanError(e), 'err'); }
    loadQueue(); loadState();
  };

  return (
    <div class="page">
      <Header title="Enquesta del dia" back="" />
      <PushCard />
      {!st ? <p class="muted">Carregant…</p> : (
        <section class="card stack eq-today">
          <div class="row small-gap"><span class="grow"><Author id={st.author_id} /></span><span class="muted small">{fmtDate(st.day)}</span></div>
          <h2 class="eq-q">{st.question}</h2>
          {answered ? (
            votes ? <Results options={st.options} votes={votes} mine={st.my_vote} /> : <p class="muted">Carregant…</p>
          ) : (
            <>
              <div class="stack tight">
                {st.options.map((o, i) => (
                  <button class={'option eq-opt' + (pick === i ? ' on' : '')} onClick={() => setPick(i)}><b class="eq-letter">{LETTERS[i]}</b> {o}</button>
                ))}
              </div>
              <button class="btn primary block" disabled={busy || pick === null} onClick={send}>{busy ? '…' : pick === null ? 'Tria una opció' : 'Respondre'}</button>
              <p class="muted small" style={{ margin: 0 }}>{st.answers} ja han respost. Veuràs què ha dit cadascú quan responguis 👀</p>
            </>
          )}
        </section>
      )}

      <section class="stack">
        <h3 class="section-title">La cua de preguntes</h3>
        <a class="card row" href={href('enquesta/nova')}>
          <span class="emoji">➕</span>
          <div class="grow">
            <strong>Proposa una pregunta</strong>
            <div class="small muted">{st ? (st.pending === 0 ? 'La cua és buida: la teva sortiria demà!' : `Hi ha ${st.pending} a la cua. Surten per ordre, una cada dia.`) : '…'}</div>
          </div>
          <span class="chev">›</span>
        </a>
        {queue && queue.length > 0 && (
          <div class="card stack tight">
            {queue.map((q) => (
              <div class="row small-gap">
                {isAdmin() && <Avatar m={memberById(q.author_id)} size={28} />}
                <div class="grow stack tight" style={{ gap: '0' }}>
                  <span class="small"><b>{q.question}</b></span>
                  <span class="muted small">Sortirà {whenLabel(q.queue_pos)}</span>
                </div>
                <button class="iconbtn ghost" aria-label="Treure de la cua" onClick={() => del(q)}>×</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section class="stack">
        <h3 class="section-title">Dies anteriors</h3>
        {!hist ? <p class="muted">Carregant…</p> : hist.length === 0 ? <p class="muted small">Encara no n'hi ha. Demà aquí veuràs la d'avui.</p> : hist.map((d) => {
          const t = tally([], d.counts);
          return (
            <a class="card stack tight" href={href('enquesta/d/' + d.day)}>
              <div class="row small-gap"><span class="grow"><Author id={d.author_id} /></span><span class="muted small">{fmtDate(d.day)}</span></div>
              <strong>{d.question}</strong>
              <span class="small">{t.total === 0 ? <span class="muted">Ningú va respondre 🦗</span> : <>🏆 {t.winners.map((i) => d.options[i]).join(' / ')} <span class="muted">· {t.pct[t.winners[0]]}% · {t.total} resp.</span></>}</span>
            </a>
          );
        })}
      </section>
      {dialog}
    </div>
  );
}

// ───────────────────────── Past day ─────────────────────────
function Day({ day }: { day: string }) {
  const [d, setD] = useState<EqDay | null | undefined>(undefined);
  const [votes, setVotes] = useState<EqResult[] | null>(null);
  useEffect(() => {
    api.eqHistory(200).then((h) => setD(h.find((x) => x.day === day) ?? null)).catch(() => setD(null));
    api.eqResults(day).then(setVotes).catch(() => setVotes([]));
  }, [day]);
  return (
    <div class="page">
      <Header title={fmtDate(day)} back="enquesta" />
      {d === undefined ? <p class="muted">Carregant…</p> : d === null ? <Empty emoji="🤷" text="Aquest dia no hi va haver enquesta." /> : (
        <section class="card stack">
          <Author id={d.author_id} />
          <h2 class="eq-q">{d.question}</h2>
          {votes ? <Results options={d.options} votes={votes} mine={d.my_vote} /> : <p class="muted">Carregant…</p>}
        </section>
      )}
    </div>
  );
}

// ───────────────────────── New question ─────────────────────────
function New() {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '', '', '']);
  const [busy, setBusy] = useState(false);
  const ready = q.trim().length >= 3 && opts.every((o) => o.trim());
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await api.eqAdd(q, opts);
      toast('Pregunta afegida a la cua 🙌');
      await loadState();
      go('enquesta');
    } catch (err) { toast(humanError(err), 'err'); }
    setBusy(false);
  };
  return (
    <div class="page">
      <Header title="Nova pregunta" back="enquesta" />
      <form class="card stack" onSubmit={submit}>
        <label>Pregunta</label>
        <input value={q} maxLength={200} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Ex: Qui acabarà abans calb?" autoFocus />
        <label>4 respostes</label>
        {opts.map((o, i) => (
          <div class="row small-gap">
            <b class="eq-letter">{LETTERS[i]}</b>
            <input value={o} maxLength={80} onInput={(e) => { const n = [...opts]; n[i] = e.currentTarget.value; setOpts(n); }} placeholder={`Opció ${LETTERS[i]}`} />
          </div>
        ))}
        <button class="btn primary block" disabled={busy || !ready}>{busy ? '…' : 'Afegir a la cua'}</button>
        <p class="muted small" style={{ margin: 0 }}>Les preguntes surten per ordre d'arribada, una cada dia, i sempre passen per davant de les de la casa. Tothom veurà que l'has fet tu.</p>
      </form>
    </div>
  );
}

function Page({ path }: { path: string[] }) {
  const [p, id] = path;
  if (p === 'nova') return <New />;
  if (p === 'd' && id) return <Day day={id} key={id} />;
  return <Today />;
}

export const enquesta: ModuleDef = {
  id: 'enquesta',
  title: 'Enquesta del dia',
  emoji: '🗳️',
  description: 'Una pregunta cada dia, 4 respostes. Què ha dit cadascú?',
  Page,
  useBadge: () => {
    const st = useEqState();
    return st && st.my_vote === null ? 'Per respondre' : null;
  },
};
