import { useMemo, useState } from 'preact/hooks';
import type { ModuleDef } from '../../core/registry';
import { act, api, getState, isAdmin, memberById, useStore } from '../../core/store';
import { go, href } from '../../core/router';
import type { Attendance, EventType, Rule } from '../../core/types';
import { Avatar, AvatarPicker, Empty, Header, Segmented, fmtDate, fmtPts, todayISO, useConfirm } from '../../ui/components';
import { basePoints, computeScores, describeRule, kidsMultiplier, Period, streaks } from './scoring';

const PERIODS: [Period, string][] = [['month', 'Aquest mes'], ['year', 'Aquest any'], ['all', 'Sempre']];

function Ranking() {
  const { data } = useStore();
  const [period, setPeriod] = useState<Period>('year');
  const [type, setType] = useState<string | null>(null);
  const scores = useMemo(
    () => computeScores(data.members, data.kids, data.eventTypes, data.meetups, data.adjustments, period, type),
    [data, period, type],
  );
  const podium = scores.slice(0, 3);
  const rest = scores.slice(3);
  const empty = scores.every((s) => s.attendances === 0 && s.adjustments === 0);
  return (
    <div class="page has-fab">
      <Header title="Rànquing" back="" right={isAdmin() && <a class="iconbtn" href={href('assistencia/config')} aria-label="Configuració">⚙</a>} />
      <Segmented value={period} options={PERIODS} onChange={setPeriod} />
      <div class="chips">
        <button class={'chip' + (type === null ? ' on' : '')} onClick={() => setType(null)}>Tot</button>
        {data.eventTypes.filter((t) => t.active).map((t) => (
          <button class={'chip' + (type === t.id ? ' on' : '')} onClick={() => setType(type === t.id ? null : t.id)}>{t.emoji} {t.name}</button>
        ))}
      </div>
      {empty ? (
        <Empty emoji="🦗" text="Encara no hi ha punts en aquest període. Registra la primera trobada!" />
      ) : (
        <>
          <div class="podium">
            {[podium[1], podium[0], podium[2]].map((s, i) => s && (
              <a class={'step p' + [2, 1, 3][i]} href={href('assistencia/persona/' + s.member.id)}>
                <div class="medal">{['🥈', '🥇', '🥉'][i]}</div>
                <Avatar m={s.member} size={[64, 84, 60][i]} />
                <div class="name">{s.member.nickname}</div>
                <div class="pts">{fmtPts(s.points)}</div>
                <div class="block-step" />
              </a>
            ))}
          </div>
          <div class="list">
            {rest.map((s, i) => (
              <a class="card row" href={href('assistencia/persona/' + s.member.id)}>
                <span class="pos">{i + 4}</span>
                <Avatar m={s.member} size={40} />
                <div class="grow">
                  <strong>{s.member.nickname}</strong>
                  <div class="muted small">{s.attendances} trobad{s.attendances === 1 ? 'a' : 'es'}</div>
                </div>
                <span class={'pts' + (s.points < 0 ? ' neg' : '')}>{fmtPts(s.points)}</span>
              </a>
            ))}
          </div>
        </>
      )}
      <div class="row gap actions">
        <a class="btn" href={href('assistencia/historial')}>📅 Historial</a>
        <a class="btn" href={href('assistencia/punts')}>± Punts</a>
        <a class="btn" href={href('assistencia/regles')}>📏 Regles</a>
      </div>
      <a class="fab" href={href('assistencia/nova')}>＋ Nova trobada</a>
    </div>
  );
}

function needsStart(t?: EventType) { return t?.rule.kind === 'meet_time'; }

function MeetupForm({ id }: { id?: string }) {
  const { data, meId } = useStore();
  const existing = id ? data.meetups.find((m) => m.id === id) : undefined;
  const types = data.eventTypes.filter((t) => t.active || t.id === existing?.type_id);
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [typeId, setTypeId] = useState(existing?.type_id ?? types[0]?.id);
  const [start, setStart] = useState(existing?.start_time?.slice(0, 5) ?? '');
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [att, setAtt] = useState<Map<string, Attendance>>(
    () => new Map((existing?.attendance ?? [{ member_id: meId!, sleep_time: null, won: null }]).map((a) => [a.member_id, { ...a, sleep_time: a.sleep_time?.slice(0, 5) ?? null }])),
  );
  const [busy, setBusy] = useState(false);
  const type = types.find((t) => t.id === typeId);
  const members = data.members.filter((m) => m.active);
  const toggle = (mid: string) => {
    const n = new Map(att);
    n.has(mid) ? n.delete(mid) : n.set(mid, { member_id: mid, sleep_time: null, won: null });
    setAtt(n);
  };
  const patch = (mid: string, p: Partial<Attendance>) => { const n = new Map(att); n.set(mid, { ...n.get(mid)!, ...p }); setAtt(n); };
  const save = async (e: Event) => {
    e.preventDefault();
    if (!typeId || att.size === 0) return;
    setBusy(true);
    const okk = await act(() => api.saveMeetup(
      { id, date, start_time: needsStart(type) && start ? start : null, type_id: typeId, comment: comment.trim() || null },
      [...att.values()].map((a) => ({ member_id: a.member_id, sleep_time: type?.rule.kind === 'sleep_hours' ? a.sleep_time || null : null, won: type?.rule.kind === 'win' ? !!a.won : null })),
    ), id ? 'Trobada actualitzada ✔' : 'Trobada registrada 🍻');
    setBusy(false);
    if (okk) go('assistencia');
  };
  const selected = members.filter((m) => att.has(m.id));
  return (
    <div class="page">
      <Header title={id ? 'Editar trobada' : 'Nova trobada'} back={id ? 'assistencia/historial' : 'assistencia'} />
      <form class="stack" onSubmit={save}>
        <label>Què heu fet?</label>
        <div class="chips wrap">
          {types.map((t) => <button type="button" class={'chip big' + (t.id === typeId ? ' on' : '')} onClick={() => setTypeId(t.id)}>{t.emoji} {t.name}</button>)}
        </div>
        {type && <p class="muted small">📏 {describeRule(type.rule)}</p>}
        <div class="row gap">
          <div class="grow stack tight"><label>Data</label><input type="date" required value={date} onInput={(e) => setDate(e.currentTarget.value)} /></div>
          {needsStart(type) && <div class="grow stack tight"><label>Hora de trobada</label><input type="time" value={start} onInput={(e) => setStart(e.currentTarget.value)} /></div>}
        </div>
        <label>Qui hi era? <span class="muted">({att.size})</span></label>
        <div class="row gap">
          <button type="button" class="btn small ghost" onClick={() => setAtt(new Map(members.map((m) => [m.id, att.get(m.id) ?? { member_id: m.id, sleep_time: null, won: null }])))}>Tothom</button>
          <button type="button" class="btn small ghost" onClick={() => setAtt(new Map())}>Ningú</button>
        </div>
        <AvatarPicker members={members} selected={new Set(att.keys())} onToggle={toggle} />

        {(type?.rule.kind === 'sleep_hours' || type?.rule.kind === 'win') && selected.length > 0 && (
          <div class="card stack">
            <h3>{type.rule.kind === 'sleep_hours' ? '🛌 A quina hora us en vau anar a dormir?' : '🏆 Qui va guanyar?'}</h3>
            {selected.map((m) => {
              const a = att.get(m.id)!;
              return (
                <div class="row">
                  <Avatar m={m} size={32} />
                  <span class="grow">{m.nickname}</span>
                  {type.rule.kind === 'sleep_hours'
                    ? <input type="time" style={{ width: '8.5rem', flex: 'none' }} value={a.sleep_time ?? ''} onInput={(e) => patch(m.id, { sleep_time: e.currentTarget.value || null })} />
                    : <button type="button" class={'btn small' + (a.won ? ' primary' : ' ghost')} onClick={() => patch(m.id, { won: !a.won })}>{a.won ? 'Ha guanyat 🏆' : 'Ha perdut'}</button>}
                </div>
              );
            })}
          </div>
        )}

        {type && selected.length > 0 && (
          <div class="card">
            <h3>Punts</h3>
            <div class="pts-preview">
              {selected.map((m) => {
                const a = att.get(m.id)!;
                const b = basePoints(type.rule, { start_time: start || null }, a);
                const mult = kidsMultiplier(data.kids, m.id, date);
                return <span class="pill"><Avatar m={m} size={22} /> {fmtPts(b * mult)}{mult > 1 && <small> (×{mult})</small>}</span>;
              })}
            </div>
          </div>
        )}

        <label>Comentari / anècdota</label>
        <textarea rows={2} value={comment} onInput={(e) => setComment(e.currentTarget.value)} placeholder="On, què va passar, qui va pagar…" />
        <button class="btn primary big" disabled={busy || att.size === 0}>{busy ? '…' : 'Desar'}</button>
      </form>
    </div>
  );
}

function History() {
  const { data, meId } = useStore();
  const [confirm, dialog] = useConfirm();
  const typeById = new Map(data.eventTypes.map((t) => [t.id, t]));
  const canEdit = (by: string | null) => isAdmin() || by === meId;
  type Item = { date: string; kind: 'm' | 'a'; id: string };
  const items: Item[] = [
    ...data.meetups.map((m) => ({ date: m.date, kind: 'm' as const, id: m.id })),
    ...data.adjustments.map((a) => ({ date: a.date, kind: 'a' as const, id: a.id })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div class="page">
      <Header title="Historial" back="assistencia" />
      {items.length === 0 && <Empty emoji="📭" text="Encara no hi ha res." />}
      <div class="list">
        {items.map((it) => {
          if (it.kind === 'm') {
            const m = data.meetups.find((x) => x.id === it.id)!;
            const t = typeById.get(m.type_id);
            return (
              <div class="card stack tight">
                <div class="row">
                  <span class="emoji">{t?.emoji}</span>
                  <div class="grow">
                    <strong>{m.comment || t?.name}</strong>
                    <div class="muted small">{fmtDate(m.date)}{m.start_time ? ` · ${m.start_time.slice(0, 5)}` : ''} · per {memberById(m.created_by)?.nickname ?? '?'}</div>
                  </div>
                  {canEdit(m.created_by) && <a class="iconbtn" href={href('assistencia/editar/' + m.id)} aria-label="Editar">✎</a>}
                  {canEdit(m.created_by) && <button class="iconbtn" aria-label="Esborrar" onClick={async () => (await confirm('Esborrar aquesta trobada?', 'Esborrar')) && act(() => api.deleteMeetup(m.id), 'Esborrada')}>🗑</button>}
                </div>
                <div class="pts-preview">
                  {m.attendance.map((a) => {
                    const pts = t ? basePoints(t.rule, m, a) * kidsMultiplier(data.kids, a.member_id, m.date) : 0;
                    return <span class="pill"><Avatar m={memberById(a.member_id)} size={22} /> {fmtPts(pts)}</span>;
                  })}
                </div>
              </div>
            );
          }
          const a = data.adjustments.find((x) => x.id === it.id)!;
          return (
            <div class="card row">
              <span class="emoji">{a.points >= 0 ? '⬆️' : '⬇️'}</span>
              <Avatar m={memberById(a.member_id)} size={32} />
              <div class="grow">
                <strong>{memberById(a.member_id)?.nickname} {fmtPts(a.points)}</strong>
                <div class="muted small">«{a.reason}» · {fmtDate(a.date)} · per {memberById(a.created_by)?.nickname ?? '?'}</div>
              </div>
              {canEdit(a.created_by) && <button class="iconbtn" aria-label="Esborrar" onClick={async () => (await confirm('Esborrar aquest ajust de punts?', 'Esborrar')) && act(() => api.deleteAdjustment(a.id), 'Esborrat')}>🗑</button>}
            </div>
          );
        })}
      </div>
      {dialog}
    </div>
  );
}

function Adjust() {
  const { data } = useStore();
  const [who, setWho] = useState<Set<string>>(new Set());
  const [pts, setPts] = useState(1);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const okk = await act(async () => { for (const id of who) await api.addAdjustment({ member_id: id, points: pts, reason: reason.trim(), date }); },
      `${fmtPts(pts)} per a ${who.size} persona${who.size === 1 ? '' : 'es'}`);
    setBusy(false);
    if (okk) go('assistencia');
  };
  return (
    <div class="page">
      <Header title="Afegir o treure punts" back="assistencia" />
      <form class="stack" onSubmit={save}>
        <label>A qui?</label>
        <AvatarPicker members={data.members.filter((m) => m.active)} selected={who} onToggle={(id) => { const n = new Set(who); n.has(id) ? n.delete(id) : n.add(id); setWho(n); }} />
        <label>Punts</label>
        <div class="stepper">
          <button type="button" class="btn" onClick={() => setPts(pts - 1)}>−</button>
          <input type="number" step="1" value={pts} onInput={(e) => setPts(Number(e.currentTarget.value) || 0)} class={pts < 0 ? 'neg' : ''} />
          <button type="button" class="btn" onClick={() => setPts(pts + 1)}>＋</button>
        </div>
        <label>Motiu (obligatori)</label>
        <input required value={reason} onInput={(e) => setReason(e.currentTarget.value)} placeholder="Ex: va pagar la ronda, va arribar tard…" />
        <label>Data</label>
        <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
        <p class="muted small">Els ajustos manuals no es multipliquen pels fills.</p>
        <button class="btn primary big" disabled={busy || who.size === 0 || pts === 0 || !reason.trim()}>Desar</button>
      </form>
    </div>
  );
}

function Person({ id }: { id: string }) {
  const { data } = useStore();
  const m = data.members.find((x) => x.id === id);
  const all = useMemo(() => computeScores(data.members, data.kids, data.eventTypes, data.meetups, data.adjustments, 'all'), [data]);
  const year = useMemo(() => computeScores(data.members, data.kids, data.eventTypes, data.meetups, data.adjustments, 'year'), [data]);
  if (!m) return <div class="page"><Header title="Persona" back="assistencia" /></div>;
  const s = all.find((x) => x.member.id === id);
  const pos = all.findIndex((x) => x.member.id === id) + 1;
  const sy = year.find((x) => x.member.id === id);
  const st = streaks(s?.lines.map((l) => l.meetup.date) ?? []);
  const kids = data.kids.filter((k) => k.member_id === id);
  const maxCount = Math.max(1, ...Object.values(s?.byType ?? {}).map((b) => b.count));
  const adj = data.adjustments.filter((a) => a.member_id === id);
  return (
    <div class="page">
      <Header title={m.nickname} back="assistencia" />
      <div class="profile-head">
        <Avatar m={m} size={112} />
        <h2>{m.nickname}</h2>
        <p class="muted">{pos}è de {all.length} · {kids.length > 0 && `👶 ×${2 ** kids.length}`}</p>
      </div>
      <div class="stats">
        <div><b>{fmtPts(s?.points ?? 0)}</b><span>punts (sempre)</span></div>
        <div><b>{fmtPts(sy?.points ?? 0)}</b><span>punts aquest any</span></div>
        <div><b>{s?.attendances ?? 0}</b><span>trobades</span></div>
        <div><b>🔥 {st.current}</b><span>setmanes seguides (rècord {st.best})</span></div>
      </div>
      <section class="card stack">
        <h3>Per tipus</h3>
        {data.eventTypes.map((t) => {
          const b = s?.byType[t.id];
          if (!b) return null;
          return (
            <div class="bar-row">
              <span class="lbl">{t.emoji} {t.name}</span>
              <div class="bar"><div style={{ width: `${(b.count / maxCount) * 100}%` }} /></div>
              <span class="num">{b.count}× · {fmtPts(b.points)}</span>
            </div>
          );
        })}
        {!s?.attendances && <p class="muted">Encara cap trobada.</p>}
      </section>
      {adj.length > 0 && (
        <section class="card stack">
          <h3>Ajustos manuals</h3>
          {adj.map((a) => <div class="row"><span class="grow">«{a.reason}» <span class="muted small">· {fmtDate(a.date)}</span></span><b>{fmtPts(a.points)}</b></div>)}
        </section>
      )}
      <section class="card stack">
        <h3>Darreres trobades</h3>
        {(s?.lines ?? []).slice(0, 15).map((l) => (
          <div class="row"><span>{l.type.emoji}</span><span class="grow">{l.meetup.comment || l.type.name} <span class="muted small">· {fmtDate(l.meetup.date)}</span></span><b>{fmtPts(l.points)}</b></div>
        ))}
      </section>
    </div>
  );
}

function Rules() {
  const { data } = useStore();
  return (
    <div class="page">
      <Header title="Regles dels punts" back="assistencia" />
      <div class="list">
        {data.eventTypes.filter((t) => t.active).map((t) => (
          <div class="card row"><span class="emoji">{t.emoji}</span><div class="grow"><strong>{t.name}</strong><div class="muted small">{describeRule(t.rule)}</div></div></div>
        ))}
        <div class="card row"><span class="emoji">👶</span><div class="grow"><strong>Multiplicador de fills</strong><div class="muted small">Punts de trobades ×2 per cada fill (1 fill ×2, 2 fills ×4, 3 fills ×8). Compta des del naixement.</div></div></div>
        <div class="card row"><span class="emoji">±</span><div class="grow"><strong>Ajustos manuals</strong><div class="muted small">Qualsevol pot afegir o treure punts amb un motiu. Qui l'ha posat o l'admin el poden esborrar. Tot queda al registre.</div></div></div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<Rule['kind'], string> = { fixed: 'Punts fixos', sleep_hours: 'Hores després de mitjanit', win: 'Guanyar/perdre', meet_time: 'Hora de trobada' };
const DEFAULT_RULE: Record<Rule['kind'], Rule> = {
  fixed: { kind: 'fixed', points: 1 }, sleep_hours: { kind: 'sleep_hours', per_hour: 1 },
  win: { kind: 'win', points: 1 }, meet_time: { kind: 'meet_time', cutoff: '09:00', early: -3, late: -1 },
};

function TypeEditor({ t, onDone }: { t?: EventType; onDone: () => void }) {
  const [f, setF] = useState<Partial<EventType>>(t ?? { name: '', emoji: '📍', rule: DEFAULT_RULE.fixed, active: true, sort_order: getState().data.eventTypes.length });
  const r = f.rule!;
  const setR = (p: any) => setF({ ...f, rule: { ...r, ...p } as Rule });
  const num = (v: string) => Number(v) || 0;
  return (
    <form class="card stack" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.saveEventType(f as any), 'Desat ✔')) onDone(); }}>
      <div class="row gap">
        <input style={{ width: '4rem', textAlign: 'center' }} value={f.emoji} onInput={(e) => setF({ ...f, emoji: e.currentTarget.value })} />
        <input class="grow" required placeholder="Nom" value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} />
      </div>
      <select value={r.kind} onChange={(e) => setF({ ...f, rule: DEFAULT_RULE[e.currentTarget.value as Rule['kind']] })}>
        {Object.entries(KIND_LABEL).map(([k, l]) => <option value={k}>{l}</option>)}
      </select>
      {r.kind === 'fixed' && <label class="row">Punts <input type="number" value={r.points} onInput={(e) => setR({ points: num(e.currentTarget.value) })} /></label>}
      {r.kind === 'win' && <label class="row">Punts si guanyes <input type="number" value={r.points} onInput={(e) => setR({ points: num(e.currentTarget.value) })} /></label>}
      {r.kind === 'sleep_hours' && <label class="row">Punts per hora <input type="number" value={r.per_hour} onInput={(e) => setR({ per_hour: num(e.currentTarget.value) })} /></label>}
      {r.kind === 'meet_time' && (<>
        <label class="row">Hora límit <input type="time" value={r.cutoff} onInput={(e) => setR({ cutoff: e.currentTarget.value })} /></label>
        <label class="row">Punts si abans <input type="number" value={r.early} onInput={(e) => setR({ early: num(e.currentTarget.value) })} /></label>
        <label class="row">Punts si després <input type="number" value={r.late} onInput={(e) => setR({ late: num(e.currentTarget.value) })} /></label>
      </>)}
      <p class="muted small">📏 {describeRule(r)}</p>
      <label class="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} /> Actiu</label>
      <div class="row end gap"><button type="button" class="btn ghost" onClick={onDone}>Cancel·lar</button><button class="btn primary">Desar</button></div>
    </form>
  );
}

function Config() {
  const { data } = useStore();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (!isAdmin()) return <div class="page"><Header title="Configuració" back="assistencia" /><p class="muted">Només per a l'admin.</p></div>;
  return (
    <div class="page">
      <Header title="Tipus i regles" back="assistencia" right={<button class="iconbtn" onClick={() => setEditing('new')} aria-label="Nou tipus">＋</button>} />
      {editing === 'new' && <TypeEditor onDone={() => setEditing(null)} />}
      <div class="list">
        {data.eventTypes.map((t) => editing === t.id ? <TypeEditor t={t} onDone={() => setEditing(null)} /> : (
          <button class={'card row' + (t.active ? '' : ' faded')} onClick={() => setEditing(t.id)}>
            <span class="emoji">{t.emoji}</span>
            <div class="grow left"><strong>{t.name}</strong><div class="muted small">{describeRule(t.rule)}{!t.active && ' · inactiu'}</div></div>
            <span class="chev">✎</span>
          </button>
        ))}
      </div>
      <p class="muted small">Els fills es gestionen a 👥 Membres → persona.</p>
    </div>
  );
}

function Page({ path }: { path: string[] }) {
  const [p, id] = path;
  if (p === 'nova') return <MeetupForm />;
  if (p === 'editar' && id) return <MeetupForm key={id} id={id} />;
  if (p === 'historial') return <History />;
  if (p === 'punts') return <Adjust />;
  if (p === 'persona' && id) return <Person id={id} />;
  if (p === 'config') return <Config />;
  if (p === 'regles') return <Rules />;
  return <Ranking />;
}

export const assistencia: ModuleDef = {
  id: 'assistencia',
  title: "Rànquing d'assistència",
  emoji: '🏆',
  description: 'Qui ve més a les trobades? Punts, podi i vergonyes.',
  Page,
  useBadge: () => {
    const { data, meId } = useStore();
    const s = computeScores(data.members, data.kids, data.eventTypes, data.meetups, data.adjustments, 'year');
    const i = s.findIndex((x) => x.member.id === meId);
    return i >= 0 ? `ets ${i + 1}è` : null;
  },
};
