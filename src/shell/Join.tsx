import { useEffect, useState } from 'preact/hooks';
import { api, setMe, toast } from '../core/store';
import { humanError } from '../core/api';
import type { RosterEntry } from '../core/types';
import { Avatar } from '../ui/components';

const CODE_KEY = 'somjoves-code';

export function Join() {
  const [code, setCode] = useState<string>(() => {
    const m = location.hash.match(/^#\/join\/(.+)$/);
    if (m) { const c = decodeURIComponent(m[1]); try { localStorage.setItem(CODE_KEY, c); } catch {} history.replaceState(null, '', '#/'); return c; }
    try { return localStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; }
  });
  const [input, setInput] = useState('');
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [who, setWho] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code && !api.demo) return;
    api.roster(code).then(setRoster).catch((e) => { toast(humanError(e), 'err'); setCode(''); try { localStorage.removeItem(CODE_KEY); } catch {} });
  }, [code]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!who) return;
    if (!who.has_pin && pin !== pin2) return toast('Els PINs no coincideixen', 'err');
    setBusy(true);
    try {
      const id = await api.join(code, who.id, pin);
      await setMe(id);
      toast(`Benvingut/da, ${who.nickname}! 🍻`);
    } catch (err) {
      toast(humanError(err), 'err');
      setPin(''); setPin2('');
    } finally { setBusy(false); }
  };

  return (
    <div class="join">
      <div class="brand">
        <div class="logo">🍻</div>
        <h1>Som joves<br /><span>però no tant</span></h1>
      </div>

      {!code && !api.demo && (
        <form class="card stack" onSubmit={(e) => { e.preventDefault(); setCode(input.trim()); }}>
          <label>Codi del grup</label>
          <input value={input} onInput={(e) => setInput(e.currentTarget.value)} placeholder="El trobaràs al grup de WhatsApp" autoFocus />
          <button class="btn primary" disabled={!input.trim()}>Entrar</button>
        </form>
      )}

      {roster && !who && (
        <div class="card">
          <h2>Qui ets?</h2>
          <div class="avatar-grid">
            {roster.map((r) => (
              <button class="pick on" onClick={() => setWho(r)}>
                <Avatar m={r} size={64} />
                <span>{r.nickname}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {who && (
        <form class="card stack center-text" onSubmit={submit}>
          <Avatar m={who} size={96} />
          <h2>{who.nickname}</h2>
          <p class="muted">{who.has_pin ? 'Introdueix el teu PIN' : 'Primer cop! Tria un PIN de 4 xifres (és entre amics, no cal que sigui el del banc 😉)'}</p>
          <input class="pin" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pin} onInput={(e) => setPin(e.currentTarget.value.replace(/\D/g, ''))} placeholder="••••" autoFocus />
          {!who.has_pin && (
            <input class="pin" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={pin2} onInput={(e) => setPin2(e.currentTarget.value.replace(/\D/g, ''))} placeholder="Repeteix" />
          )}
          <button class="btn primary" disabled={busy || pin.length !== 4}>{busy ? '…' : 'Som-hi'}</button>
          <button type="button" class="btn ghost" onClick={() => { setWho(null); setPin(''); setPin2(''); }}>No sóc jo</button>
        </form>
      )}
      {api.demo && <p class="muted small center-text">Mode demo: les dades només es guarden en aquest navegador.</p>}
    </div>
  );
}
