// Sends the daily "Enquesta del dia" push notifications. Run by .github/workflows/push.yml.
// SLOT=auto decides from the Europe/Madrid clock: runs a few minutes early and waits for 9:00 / 20:00.
// The server (push_job/push_done) makes sure each slot is sent only once per day.
import webpush from 'web-push';

const { SUPABASE_URL, SUPABASE_ANON_KEY, PUSH_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
let slot = process.env.SLOT || 'auto';
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, PUSH_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY })) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
}

function madridClock() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, Number(x.value)]));
  return { h: p.hour, m: p.minute, s: p.second };
}

async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

if (slot === 'auto') {
  const { h, m, s } = madridClock();
  const target = h === 8 || h === 9 ? 'mati' : h === 19 || h === 20 ? 'vespre' : null;
  if (!target || ((h === 8 || h === 19) && m < 30)) { console.log(`Madrid ${h}:${m}: not a notification time`); process.exit(0); }
  if (h === 8 || h === 19) {
    const wait = ((59 - m) * 60 + (60 - s)) * 1000;
    console.log(`Waiting ${Math.round(wait / 1000)}s until ${h + 1}:00 Madrid`);
    await new Promise((r) => setTimeout(r, wait));
  }
  slot = target;
}

const job = await rpc('push_job', { p_token: PUSH_TOKEN, p_slot: slot });
if (!job) { console.log(`Slot "${slot}" already sent today`); process.exit(0); }

webpush.setVapidDetails('https://escapa12.github.io/som-joves/', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const payload = JSON.stringify({ title: job.title, body: job.body, url: job.url, tag: job.tag });
let ok = 0, gone = 0, failed = 0;
await Promise.all(job.subs.map(async (s) => {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'normal' });
    ok++;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { gone++; await rpc('push_gone', { p_token: PUSH_TOKEN, p_endpoint: s.endpoint }).catch(() => {}); }
    else { failed++; console.error(`Push failed (${e.statusCode ?? '?'}): ${e.body ?? e.message}`); }
  }
}));
await rpc('push_done', { p_token: PUSH_TOKEN, p_slot: slot });
console.log(`Slot "${slot}": ${ok} sent, ${gone} expired removed, ${failed} failed (of ${job.subs.length})`);
