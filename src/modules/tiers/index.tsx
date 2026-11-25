import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ModuleDef } from '../../core/registry';
import { api, getState, isAdmin, memberById, toast, useStore } from '../../core/store';
import { humanError } from '../../core/api';
import { go, href } from '../../core/router';
import { Placements, TIERS, Tier, TierGame, TierScore, GuessResult } from '../../core/types';
import { Avatar, Empty, Header, useConfirm } from '../../ui/components';

const TIER_COLORS: Record<Tier, string> = { S: '#ff5c7a', A: '#ff9f43', B: '#ffd23f', C: '#7bd389', D: '#5bc0ff', E: '#a68bff' };
const emptyPlacements = (): Placements => ({ S: [], A: [], B: [], C: [], D: [], E: [] });

// Shared cache so the home badge and list don't refetch constantly
let cache: TierGame[] | null = null;
let cacheFor: string | null = null;
const listeners = new Set<() => void>();
async function loadGames() {
  try { cacheFor = getState().meId; cache = await api.tierGames(); } catch (e) { toast(humanError(e), 'err'); cache = cache ?? []; }
  listeners.forEach((f) => f());
}
function useGames(): TierGame[] | null {
  const [, f] = useState(0);
  const { meId } = useStore();
  if (cacheFor !== meId) { cache = null; }
  useEffect(() => {
    const l = () => f((x) => x + 1);
    listeners.add(l);
    if (!cache || cacheFor !== getState().meId) loadGames();
    return () => { listeners.delete(l); };
  }, []);
  return cache;
}

function Board({ placements, selected, onTier, renderFace }: {
  placements: Placements;
  selected?: string | null;
  onTier?: (t: Tier) => void;
  renderFace?: (id: string) => preact.JSX.Element;
}) {
  return (
    <div class="tier-board">
      {TIERS.map((t) => (
        <div class={'tier-row' + (onTier && selected ? ' droppable' : '')} data-tier={t} onClick={() => onTier?.(t)}>
          <div class="tier-label" style={{ background: TIER_COLORS[t] }}>{t}</div>
          <div class="tier-faces">
            {placements[t].map((id) => renderFace ? renderFace(id) : <Avatar m={memberById(id)} size={48} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

const clearGhosts = () => {
  document.querySelectorAll('.drag-ghost').forEach((el) => el.remove());
  document.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
};
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', clearGhosts);
  window.addEventListener('blur', clearGhosts);
}

/** Face that can be tapped (select) or dragged (pointer events, works on touch). */
function DragFace({ id, selected, onTap, onDrop }: { id: string; selected: boolean; onTap: () => void; onDrop: (target: Tier | 'bench' | null) => void }) {
  const st = useRef<{ x: number; y: number; ghost: HTMLElement | null; pid: number } | null>(null);
  const m = memberById(id);
  useEffect(() => () => { if (st.current?.ghost) clearGhosts(); st.current = null; }, []);
  const abort = () => { clearGhosts(); st.current = null; };
  const down = (e: PointerEvent) => {
    clearGhosts();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    st.current = { x: e.clientX, y: e.clientY, ghost: null, pid: e.pointerId };
  };
  const move = (e: PointerEvent) => {
    const s = st.current;
    if (!s) return;
    if (!s.ghost && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) {
      const g = (e.currentTarget as HTMLElement).cloneNode(true) as HTMLElement;
      g.classList.add('drag-ghost');
      document.body.appendChild(g);
      s.ghost = g;
    }
    if (s.ghost) {
      // auto-scroll when dragging near the screen edges (small phones)
      const edge = 70, vh = window.innerHeight;
      if (e.clientY < edge) window.scrollBy(0, -14);
      else if (e.clientY > vh - edge) window.scrollBy(0, 14);
      s.ghost.style.left = e.clientX - 28 + 'px';
      s.ghost.style.top = e.clientY - 28 + 'px';
      document.querySelectorAll('.drop-hover').forEach((el) => el.classList.remove('drop-hover'));
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tier],[data-bench]');
      el?.classList.add('drop-hover');
    }
  };
  const up = (e: PointerEvent) => {
    const s = st.current;
    st.current = null;
    if (!s) return;
    if (s.ghost) {
      clearGhosts();
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tier],[data-bench]') as HTMLElement | null;
      onDrop(el ? ((el.dataset.tier as Tier) ?? 'bench') : null);
    } else onTap();
  };
  return (
    <div class={'drag-face' + (selected ? ' selected' : '')} onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={abort} onLostPointerCapture={() => { if (st.current?.ghost) abort(); }} onClick={(e) => e.stopPropagation()}>
      <Avatar m={m} size={52} />
      <span>{m?.nickname}</span>
    </div>
  );
}

function Create() {
  const { data } = useStore();
  const active = data.members.filter((m) => m.active);
  const [pl, setPl] = useState<Placements>(emptyPlacements);
  const [sel, setSel] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [real, setReal] = useState('');
  const [decoys, setDecoys] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const placed = new Set(TIERS.flatMap((t) => pl[t]));
  const bench = active.filter((m) => !placed.has(m.id));

  const place = (id: string, target: Tier | 'bench' | null) => {
    if (!target) return;
    const n = emptyPlacements();
    for (const t of TIERS) n[t] = pl[t].filter((x) => x !== id);
    if (target !== 'bench') n[target].push(id);
    setPl(n);
    setSel(null);
  };
  const face = (id: string) => (
    <DragFace key={id} id={id} selected={sel === id} onTap={() => setSel(sel === id ? null : id)} onDrop={(t) => place(id, t)} />
  );
  const cats = [real, ...decoys].map((c) => c.trim());
  const valid = cats.every(Boolean) && new Set(cats.map((c) => c.toLowerCase())).size === cats.length;

  const publish = async () => {
    setBusy(true);
    try {
      const id = await api.tierCreate(pl, cats, 0);
      await loadGames();
      toast('Llista publicada! Ara que endevinin 🕵️');
      go('tiers/' + id);
    } catch (e) { toast(humanError(e), 'err'); }
    setBusy(false);
  };

  if (step === 1) return (
    <div class="page">
      <Header title="Nova llista · 1/2" back="tiers" />
      <p class="muted small">Arrossega les cares a cada tier, o toca una cara i després el tier. Cal col·locar tothom.</p>
      <Board placements={pl} selected={sel} onTier={(t) => sel && place(sel, t)} renderFace={face} />
      <div class={'bench' + (sel && placed.has(sel) ? ' droppable' : '')} data-bench="1" onClick={() => sel && place(sel, 'bench')}>
        <div class="bench-title">🪑 Banqueta ({bench.length})</div>
        <div class="tier-faces">{bench.map((m) => face(m.id))}</div>
      </div>
      <button class="btn primary big block" disabled={bench.length > 0} onClick={() => setStep(2)}>
        {bench.length > 0 ? `Falten ${bench.length} per col·locar` : 'Següent: categories →'}
      </button>
    </div>
  );

  return (
    <div class="page">
      <Header title="Nova llista · 2/2" back="tiers" />
      <form class="stack" onSubmit={(e) => { e.preventDefault(); valid && publish(); }}>
        <label>✅ Categoria real (secreta)</label>
        <input required value={real} onInput={(e) => setReal(e.currentTarget.value)} placeholder="Ex: Millor ballarí" />
        <label>🎭 Categories trampa ({decoys.length})</label>
        {decoys.map((d, i) => (
          <div class="row gap">
            <input class="grow" required value={d} onInput={(e) => { const n = [...decoys]; n[i] = e.currentTarget.value; setDecoys(n); }} placeholder={`Trampa ${i + 1}`} />
            {decoys.length > 2 && <button type="button" class="iconbtn" onClick={() => setDecoys(decoys.filter((_, j) => j !== i))} aria-label="Treure">✕</button>}
          </div>
        ))}
        {decoys.length < 4 && <button type="button" class="btn ghost small" onClick={() => setDecoys([...decoys, ''])}>＋ Afegir trampa</button>}
        <p class="muted small">Total {cats.length} opcions (3–5). Es barregen a l'atzar. Truc: trampes creïbles = més punts per tu si alguns encerten i d'altres no.</p>
        {!valid && cats.every(Boolean) && <p class="error small">Les categories han de ser diferents.</p>}
        <div class="row gap">
          <button type="button" class="btn ghost" onClick={() => setStep(1)}>← Tiers</button>
          <button class="btn primary grow" disabled={!valid || busy}>{busy ? '…' : 'Publicar 🚀'}</button>
        </div>
      </form>
    </div>
  );
}

function Result({ game, res }: { game: TierGame; res: { real_index: number; creator_id: string; my_category: number | null; my_creator: string | null } }) {
  const okCat = res.my_category === res.real_index;
  const okCreator = res.my_creator === res.creator_id;
  return (
    <div class="card stack result">
      {res.my_category !== null && <h2 class="center-text">{okCat && okCreator ? '🎯 Ple total! +5' : okCat ? '✅ Categoria encertada! +3' : okCreator ? '🕵️ Has endevinat l\'autor! +2' : '🙈 Res de res'}</h2>}
      <div class="stack tight">
        {game.candidates.map((c, i) => (
          <div class={'option static' + (i === res.real_index ? ' right' : i === res.my_category ? ' wrong' : '')}>
            {i === res.real_index ? '✅ ' : i === res.my_category ? '❌ ' : ''}{c}
          </div>
        ))}
      </div>
      <div class="row center gap">
        <span>L'ha fet</span><Avatar m={memberById(res.creator_id)} size={40} /><strong>{memberById(res.creator_id)?.nickname}</strong>
        {res.my_category !== null && <span>{okCreator ? '✅' : `❌ (deies ${memberById(res.my_creator)?.nickname ?? 'ningú'})`}</span>}
      </div>
    </div>
  );
}

function Play({ id }: { id: string }) {
  const { meId, data } = useStore();
  const games = useGames();
  const g = games?.find((x) => x.id === id);
  const [cat, setCat] = useState<number | null>(null);
  const [creator, setCreator] = useState<string | null>(null);
  const [res, setRes] = useState<GuessResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, dialog] = useConfirm();
  if (!games) return <div class="page"><Header title="Joc de tiers" back="tiers" /><p class="muted">Carregant…</p></div>;
  if (!g) return <div class="page"><Header title="Joc de tiers" back="tiers" /><p class="muted">Aquesta llista no existeix.</p></div>;
  const done = g.my_category !== null || res;
  const submit = async () => {
    if (cat === null) return;
    setBusy(true);
    try { setRes(await api.tierGuess(g.id, cat, creator)); loadGames(); } catch (e) { toast(humanError(e), 'err'); }
    setBusy(false);
  };
  const others = data.members.filter((m) => m.active && m.id !== meId);
  return (
    <div class="page">
      <Header title="Quina és la categoria?" back="tiers"
        right={(g.is_creator || isAdmin()) && <button class="iconbtn" aria-label="Esborrar" onClick={async () => {
          if (await confirm('Esborrar aquesta llista i tots els vots?', 'Esborrar')) { try { await api.tierDelete(g.id); await loadGames(); go('tiers'); } catch (e) { toast(humanError(e), 'err'); } }
        }}>🗑</button>} />
      <Board placements={g.placements} />
      <p class="muted small center-text">{g.guesses} vot{g.guesses === 1 ? '' : 's'} · {g.correct} encert{g.correct === 1 ? '' : 's'}</p>

      {g.is_creator && (
        <div class="card stack">
          <h3>És la teva llista 🤫</h3>
          <Result game={g} res={{ real_index: g.real_index!, creator_id: meId!, my_category: null, my_creator: null }} />
          <p class="muted small">Guanyes +3 si l'encerten alguns però no tots.</p>
        </div>
      )}

      {!g.is_creator && done && (
        <Result game={g} res={{
          real_index: res?.real_index ?? g.real_index!, creator_id: res?.creator_id ?? g.creator_id!,
          my_category: res ? cat : g.my_category, my_creator: res ? creator : g.my_creator_guess,
        }} />
      )}

      {!g.is_creator && !done && (
        <div class="stack">
          <h3>1. Quina és la categoria real?</h3>
          <div class="stack tight">
            {g.candidates.map((c, i) => <button class={'option' + (cat === i ? ' on' : '')} onClick={() => setCat(i)}>{c}</button>)}
          </div>
          <h3>2. Qui l'ha fet? <span class="muted small">(opcional, +2)</span></h3>
          <div class="avatar-grid">
            {others.map((m) => (
              <button class={'pick' + (creator === m.id ? ' on' : '')} onClick={() => setCreator(creator === m.id ? null : m.id)}>
                <Avatar m={m} size={48} dim={creator !== null && creator !== m.id} /><span>{m.nickname}</span>
              </button>
            ))}
          </div>
          <button class="btn primary big" disabled={cat === null || busy} onClick={submit}>{busy ? '…' : 'Enviar resposta'}</button>
        </div>
      )}
      {dialog}
    </div>
  );
}

function List() {
  const { data } = useStore();
  const games = useGames();
  const [lb, setLb] = useState<TierScore[] | null>(null);
  useEffect(() => { loadGames(); api.tierLeaderboard().then(setLb).catch(() => setLb([])); }, []);
  const groups = useMemo(() => {
    const g = games ?? [];
    return {
      todo: g.filter((x) => !x.is_creator && x.my_category === null),
      mine: g.filter((x) => x.is_creator),
      done: g.filter((x) => !x.is_creator && x.my_category !== null),
    };
  }, [games]);
  const preview = (g: TierGame) => (
    <a class="card tier-preview" href={href('tiers/' + g.id)}>
      <div class="mini-board">
        {TIERS.filter((t) => g.placements[t].length).slice(0, 3).map((t) => (
          <div class="mini-row"><b style={{ background: TIER_COLORS[t] }}>{t}</b>{g.placements[t].slice(0, 6).map((id) => <Avatar m={memberById(id)} size={24} />)}</div>
        ))}
      </div>
      <div class="muted small">{new Date(g.created_at).toLocaleDateString('ca-ES')} · {g.guesses} vots
        {g.my_category !== null && (g.my_category === g.real_index ? ' · ✅' : ' · ❌')}</div>
    </a>
  );
  const sorted = (lb ?? []).filter((s) => s.games_played + s.games_created > 0).sort((a, b) => b.points - a.points);
  return (
    <div class="page has-fab">
      <Header title="Joc de tiers" back="" />
      <p class="muted small">Algú ordena el grup en tiers S–E segons una categoria secreta. Endevina la categoria (+3) i qui l'ha fet (+2).</p>
      {!games ? <p class="muted">Carregant…</p> : games.length === 0 ? <Empty emoji="🃏" text="Encara no hi ha cap llista. Fes la primera!" /> : (<>
        {groups.todo.length > 0 && <><h3 class="section-title">🕵️ Per endevinar ({groups.todo.length})</h3>{groups.todo.map(preview)}</>}
        {groups.mine.length > 0 && <><h3 class="section-title">✍️ Les meves</h3>{groups.mine.map(preview)}</>}
        {groups.done.length > 0 && <><h3 class="section-title">✔️ Ja jugades</h3>{groups.done.map(preview)}</>}
      </>)}
      {sorted.length > 0 && (
        <section class="card stack">
          <h3>🏅 Classificació</h3>
          {sorted.map((s, i) => (
            <div class="row"><span class="pos">{i + 1}</span><Avatar m={data.members.find((m) => m.id === s.member_id)} size={32} />
              <span class="grow">{memberById(s.member_id)?.nickname} <span class="muted small">· {s.games_played} jugades, {s.games_created} creades</span></span><b>{s.points}</b></div>
          ))}
        </section>
      )}
      <a class="fab" href={href('tiers/nou')}>＋ Nova llista</a>
    </div>
  );
}

function Page({ path }: { path: string[] }) {
  const [p] = path;
  if (p === 'nou') return <Create />;
  if (p) return <Play id={p} key={p} />;
  return <List />;
}

export const tiers: ModuleDef = {
  id: 'tiers',
  title: 'Joc de tiers',
  emoji: '🃏',
  description: 'Endevina la categoria secreta i qui ha fet la llista.',
  Page,
  useBadge: () => {
    const g = useGames();
    const n = g?.filter((x) => !x.is_creator && x.my_category === null).length ?? 0;
    return n ? `${n} per jugar` : null;
  },
};

