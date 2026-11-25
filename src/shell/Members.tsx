import { useState } from 'preact/hooks';
import { act, api, isAdmin, setMe, useStore } from '../core/store';
import { go, href } from '../core/router';
import type { Member } from '../core/types';
import { Avatar, Header, Sheet, useConfirm } from '../ui/components';

async function fileToAvatar(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const r = Math.min(s / img.width, s / img.height);
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
  const webp = c.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
}

export function MembersList() {
  const { data } = useStore();
  const [adding, setAdding] = useState(false);
  const list = [...data.members].sort((a, b) => Number(b.active) - Number(a.active) || a.sort_order - b.sort_order);
  return (
    <div class="page">
      <Header title="Membres" back="" right={isAdmin() && <button class="iconbtn" onClick={() => setAdding(true)} aria-label="Afegir membre">＋</button>} />
      <div class="list">
        {list.map((m) => (
          <a class={'card row' + (m.active ? '' : ' faded')} href={href('membres/' + m.id)}>
            <Avatar m={m} size={48} />
            <div class="grow">
              <strong>{m.nickname}</strong> {m.role === 'admin' && <span class="tag">admin</span>}
              <div class="muted small">{m.real_name}{!m.active && ' · inactiu'}</div>
            </div>
            <span class="chev">›</span>
          </a>
        ))}
      </div>
      <MemberForm open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function MemberForm({ open, onClose, member }: { open: boolean; onClose: () => void; member?: Member }) {
  const [f, setF] = useState<Partial<Member>>(member ?? { nickname: '', real_name: '', avatar_data: null, role: 'member', active: true });
  const save = async (e: Event) => {
    e.preventDefault();
    if (await act(() => api.saveMember({ ...f, nickname: f.nickname!.trim() } as any), 'Desat ✔')) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={member ? 'Editar membre' : 'Nou membre'}>
      <form class="stack" onSubmit={save}>
        <div class="center-text"><Avatar m={{ id: f.id ?? 'new', nickname: f.nickname || '?', avatar_data: f.avatar_data ?? null }} size={96} /></div>
        <label>Foto (millor la cara retallada, PNG transparent)</label>
        <input type="file" accept="image/*" onChange={async (e) => { const file = e.currentTarget.files?.[0]; if (file) setF({ ...f, avatar_data: await fileToAvatar(file) }); }} />
        <label>Àlies</label>
        <input required value={f.nickname} onInput={(e) => setF({ ...f, nickname: e.currentTarget.value })} />
        <label>Nom real</label>
        <input value={f.real_name ?? ''} onInput={(e) => setF({ ...f, real_name: e.currentTarget.value })} />
        <label class="check"><input type="checkbox" checked={f.role === 'admin'} onChange={(e) => setF({ ...f, role: e.currentTarget.checked ? 'admin' : 'member' })} /> Admin</label>
        <label class="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.currentTarget.checked })} /> Actiu (surt als rànquings)</label>
        <button class="btn primary">Desar</button>
      </form>
    </Sheet>
  );
}

export function MemberDetail({ id }: { id: string }) {
  const { data, meId } = useStore();
  const m = data.members.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [kidName, setKidName] = useState('');
  const [kidDate, setKidDate] = useState('');
  const [code, setCode] = useState('');
  const [confirm, dialog] = useConfirm();
  if (!m) return <div class="page"><Header title="Membre" back="membres" /><p class="muted">No trobat.</p></div>;
  const kids = data.kids.filter((k) => k.member_id === id);
  const admin = isAdmin();
  return (
    <div class="page">
      <Header title={m.nickname} back="membres" right={admin && <button class="iconbtn" onClick={() => setEdit(true)} aria-label="Editar">✎</button>} />
      <div class="profile-head">
        <Avatar m={m} size={128} />
        <h2>{m.nickname}</h2>
        <p class="muted">{m.real_name}{m.role === 'admin' ? ' · admin' : ''}</p>
        {kids.length > 0 && <p class="tag big">👶 ×{2 ** kids.length} multiplicador</p>}
      </div>
      <a class="btn block" href={href('assistencia/persona/' + id)}>📊 Veure estadístiques d'assistència</a>

      {(admin || kids.length > 0) && (
        <section class="card stack">
          <h3>Fills (multiplicador ×2 per fill)</h3>
          {kids.map((k) => (
            <div class="row">
              <span class="grow">👶 {k.name || 'Fill/a'} {k.born_on ? <span class="muted small">· des del {k.born_on}</span> : <span class="muted small">· compta sempre</span>}</span>
              {admin && <button class="btn small ghost" onClick={async () => (await confirm('Treure aquest fill del càlcul?', 'Treure')) && act(() => api.deleteKid(k.id))}>Treure</button>}
            </div>
          ))}
          {admin && (
            <form class="row wrap" onSubmit={(e) => { e.preventDefault(); act(() => api.saveKid({ member_id: id, name: kidName || null, born_on: kidDate || null }), 'Afegit 👶').then(() => { setKidName(''); setKidDate(''); }); }}>
              <input class="grow" placeholder="Nom (opcional)" value={kidName} onInput={(e) => setKidName(e.currentTarget.value)} />
              <input type="date" value={kidDate} onInput={(e) => setKidDate(e.currentTarget.value)} title="Data de naixement (el multiplicador compta des d'aquí)" />
              <button class="btn small">Afegir</button>
            </form>
          )}
        </section>
      )}

      {admin && (
        <section class="card stack">
          <h3>Admin</h3>
          <button class="btn ghost" onClick={async () => (await confirm(`Esborrar el PIN de ${m.nickname}? Haurà de triar-ne un de nou.`, 'Esborrar PIN')) && act(() => api.resetPin(id), 'PIN esborrat')}>🔑 Reiniciar PIN</button>
          {id === meId && (
            <form class="row" onSubmit={(e) => { e.preventDefault(); act(() => api.setGroupCode(code.trim()), 'Codi canviat').then(() => setCode('')); }}>
              <input class="grow" placeholder="Nou codi del grup" value={code} onInput={(e) => setCode(e.currentTarget.value)} />
              <button class="btn small" disabled={code.trim().length < 4}>Canviar</button>
            </form>
          )}
        </section>
      )}

      {id === meId && (
        <button class="btn ghost block" onClick={async () => { if (await confirm('Sortir d\'aquest dispositiu?', 'Sortir')) { await api.leave(); await setMe(null); go(''); } }}>🚪 Sortir d'aquest dispositiu</button>
      )}
      {edit && <MemberForm open onClose={() => setEdit(false)} member={m} />}
      {dialog}
    </div>
  );
}

