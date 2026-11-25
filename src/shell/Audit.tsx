import { useEffect, useState } from 'preact/hooks';
import { api, memberById, useStore } from '../core/store';
import type { AuditEntry } from '../core/types';
import { Avatar, Header, fmtDate } from '../ui/components';

const ENT: Record<string, string> = {
  att_meetups: 'trobada', att_attendance: 'assistència', att_adjustments: 'ajust de punts',
  att_event_types: 'tipus d\'event', members: 'membre', member_kids: 'fill',
};
const ACT: Record<string, string> = { insert: 'ha afegit', update: 'ha modificat', delete: 'ha esborrat' };

function detail(e: AuditEntry): string {
  const r = e.after ?? e.before ?? {};
  if (e.entity === 'att_meetups' && r.deleted_at) return `ha esborrat la trobada del ${fmtDate(r.date)}`;
  if (e.entity === 'att_adjustments') return `${ACT[e.action]} ${r.points > 0 ? '+' : ''}${r.points} a ${memberById(r.member_id)?.nickname ?? '?'} («${r.reason}»)`;
  if (e.entity === 'att_attendance') return `${ACT[e.action]} ${memberById(r.member_id)?.nickname ?? '?'} a una trobada`;
  if (e.entity === 'members') return `${ACT[e.action]} el membre ${r.nickname}`;
  if (e.entity === 'att_meetups') return `${ACT[e.action]} la trobada del ${fmtDate(r.date)}${r.comment ? ` («${r.comment}»)` : ''}`;
  if (e.entity === 'att_event_types') return `${ACT[e.action]} el tipus ${r.emoji ?? ''} ${r.name}`;
  return `${ACT[e.action]} ${ENT[e.entity] ?? e.entity}`;
}

export function Audit() {
  useStore();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  useEffect(() => { api.audit(200).then(setRows).catch(() => setRows([])); }, []);
  return (
    <div class="page">
      <Header title="Registre de canvis" back="" />
      {!rows ? <p class="muted">Carregant…</p> : rows.length === 0 ? <p class="muted">Encara no hi ha canvis.</p> : (
        <div class="list">
          {rows.filter((e) => e.entity !== 'att_attendance').map((e) => {
            const who = memberById(e.actor_id);
            return (
              <div class="card row small-gap">
                <Avatar m={who} size={32} />
                <div class="grow">
                  <div><strong>{who?.nickname ?? 'Sistema'}</strong> {detail(e)}</div>
                  <div class="muted small">{new Date(e.at).toLocaleString('ca-ES', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
