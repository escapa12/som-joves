import { modules } from '../modules';
import { me, useStore, memberById } from '../core/store';
import { href } from '../core/router';
import { Avatar, fmtDate } from '../ui/components';

function Badge({ use }: { use: () => string | null }) {
  const b = use();
  return b ? <span class="badge">{b}</span> : null;
}

export function Home() {
  const { data } = useStore();
  const m = me();
  const recent = data.meetups.slice(0, 3);
  const typeById = new Map(data.eventTypes.map((t) => [t.id, t]));
  return (
    <div class="page">
      <header class="home-head">
        <div>
          <p class="muted small">Som joves però no tant</p>
          <h1>Hola, {m?.nickname}!</h1>
        </div>
        <a href={href('membres/' + m?.id)}><Avatar m={m} size={52} ring /></a>
      </header>

      <div class="modules">
        {modules.map((mod) => (
          <a class="module-card" href={href(mod.id)}>
            <span class="emoji">{mod.emoji}</span>
            <div>
              <h2>{mod.title} {mod.useBadge && <Badge use={mod.useBadge} />}</h2>
              <p>{mod.description}</p>
            </div>
          </a>
        ))}
      </div>

      {recent.length > 0 && (
        <section>
          <h3 class="section-title">Darreres trobades</h3>
          {recent.map((mt) => (
            <a class="card meetup-mini" href={href('assistencia/historial')}>
              <span class="emoji">{typeById.get(mt.type_id)?.emoji}</span>
              <div class="grow">
                <strong>{mt.comment || typeById.get(mt.type_id)?.name}</strong>
                <div class="muted small">{fmtDate(mt.date)}</div>
              </div>
              <div class="face-stack">
                {mt.attendance.slice(0, 5).map((a) => <Avatar m={memberById(a.member_id)} size={28} />)}
                {mt.attendance.length > 5 && <span class="more">+{mt.attendance.length - 5}</span>}
              </div>
            </a>
          ))}
        </section>
      )}

      <nav class="footer-links">
        <a href={href('membres')}>👥 Membres</a>
        <a href={href('registre')}>📜 Registre de canvis</a>
      </nav>
    </div>
  );
}
