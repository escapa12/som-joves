import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Member } from '../core/types';
import { href } from '../core/router';

const PALETTE = ['#ff8a5b', '#5bc0ff', '#b38bff', '#5be3a8', '#ffcc33', '#ff5c8a', '#4dd4d4', '#c9e265'];
const colorFor = (id: string) => PALETTE[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (n: string) => n.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

export function Avatar({ m, size = 44, dim = false, ring = false }: { m: Pick<Member, 'id' | 'nickname' | 'avatar_data'> | undefined; size?: number; dim?: boolean; ring?: boolean }) {
  if (!m) return <div class="avatar" style={{ width: size + 'px', height: size + 'px' }} />;
  const style = { width: size + 'px', height: size + 'px', opacity: dim ? 0.35 : 1, fontSize: size * 0.36 + 'px' };
  return m.avatar_data ? (
    <img class={'avatar img' + (ring ? ' ring' : '')} src={m.avatar_data} alt={m.nickname} title={m.nickname} style={style} draggable={false} />
  ) : (
    <div class={'avatar initials' + (ring ? ' ring' : '')} title={m.nickname} style={{ ...style, background: colorFor(m.id) }}>{initials(m.nickname)}</div>
  );
}

export function Header({ title, back, right }: { title: string; back?: string; right?: ComponentChildren }) {
  return (
    <header class="topbar">
      {back !== undefined ? <a class="iconbtn" href={href(back)} aria-label="Enrere">‹</a> : <span class="iconbtn ghost" />}
      <h1>{title}</h1>
      <div class="right">{right}</div>
    </header>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ComponentChildren }) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', k); };
  }, [open]);
  if (!open) return null;
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label={title}>
        <div class="sheet-head"><h2>{title}</h2><button class="iconbtn" onClick={onClose} aria-label="Tancar">✕</button></div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function useConfirm(): [(text: string, yes?: string) => Promise<boolean>, preact.JSX.Element | null] {
  const [st, setSt] = useState<{ text: string; yes: string; res: (b: boolean) => void } | null>(null);
  const ask = (text: string, yes = 'Sí') => new Promise<boolean>((res) => setSt({ text, yes, res }));
  const close = (b: boolean) => { st?.res(b); setSt(null); };
  const el = st ? (
    <div class="sheet-backdrop center" onClick={(e) => e.target === e.currentTarget && close(false)}>
      <div class="dialog">
        <p>{st.text}</p>
        <div class="row end">
          <button class="btn ghost" onClick={() => close(false)}>Cancel·lar</button>
          <button class="btn danger" onClick={() => close(true)}>{st.yes}</button>
        </div>
      </div>
    </div>
  ) : null;
  return [ask, el];
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="tablist">
      {options.map(([v, l]) => (
        <button role="tab" aria-selected={v === value} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function AvatarPicker({ members, selected, onToggle }: { members: Member[]; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div class="avatar-grid">
      {members.map((m) => (
        <button type="button" class={'pick' + (selected.has(m.id) ? ' on' : '')} onClick={() => onToggle(m.id)} aria-pressed={selected.has(m.id)}>
          <Avatar m={m} size={56} dim={!selected.has(m.id)} />
          <span>{m.nickname}</span>
        </button>
      ))}
    </div>
  );
}

export function Empty({ emoji, text, children }: { emoji: string; text: string; children?: ComponentChildren }) {
  return <div class="empty"><div class="big">{emoji}</div><p>{text}</p>{children}</div>;
}

export const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric', month: 'short', year: d.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' });

export const fmtPts = (n: number) => (n > 0 ? '+' : '') + (Number.isInteger(n) ? n : n.toFixed(1));

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
