-- Som joves però no tant — Supabase schema
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent where possible).
-- Requires: Authentication → Sign In / Providers → "Allow anonymous sign-ins" ON.

-- Supabase installs pgcrypto in the `extensions` schema; locally it may be in public. Functions use search_path public, extensions.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
set search_path = public, extensions;

-- ───────────────────────── Core ─────────────────────────
create table if not exists app_config (
  id int primary key default 1 check (id = 1),
  group_code_hash text not null
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  nickname text not null unique,
  real_name text,
  avatar_data text,                 -- data:image/webp;base64,...
  role text not null default 'member' check (role in ('admin','member')),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists member_secrets (
  member_id uuid primary key references members(id) on delete cascade,
  pin_hash text not null
);

create table if not exists devices (
  auth_uid uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists member_kids (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  name text,
  born_on date                       -- null = counts for all dates
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  entity text not null,
  entity_id text,
  action text not null,
  before jsonb,
  after jsonb
);

-- ───────────────────────── Assistència ─────────────────────────
create table if not exists att_event_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '📍',
  rule jsonb not null default '{"kind":"fixed","points":1}',
  active boolean not null default true,
  sort_order int not null default 0
);

create table if not exists att_meetups (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  start_time time,
  type_id uuid not null references att_event_types(id),
  comment text,
  created_by uuid references members(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists att_attendance (
  meetup_id uuid not null references att_meetups(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  sleep_time time,
  won boolean,
  primary key (meetup_id, member_id)
);

create table if not exists att_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  points numeric not null,
  reason text not null check (length(trim(reason)) > 0),
  date date not null default current_date,
  created_by uuid references members(id),
  created_at timestamptz not null default now()
);

-- ───────────────────────── Joc de tiers ─────────────────────────
create table if not exists tier_games (
  id uuid primary key default gen_random_uuid(),
  placements jsonb not null,          -- {"S":[member ids],"A":[],...,"E":[]}
  candidates jsonb not null,          -- ["cat 1","cat 2",...] 3..5, shuffled
  created_at timestamptz not null default now()
);

create table if not exists tier_secrets (
  game_id uuid primary key references tier_games(id) on delete cascade,
  creator_id uuid not null references members(id),
  real_index int not null
);

create table if not exists tier_guesses (
  game_id uuid not null references tier_games(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  category_index int not null,
  creator_guess_id uuid references members(id),
  correct_category boolean not null,
  correct_creator boolean not null,
  at timestamptz not null default now(),
  primary key (game_id, member_id)
);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function current_member() returns uuid
language sql stable security definer set search_path = public, extensions as $fn$
  select member_id from devices where auth_uid = auth.uid()
$fn$;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public, extensions as $fn$
  select exists(select 1 from devices d join members m on m.id = d.member_id
                where d.auth_uid = auth.uid() and m.active)
$fn$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, extensions as $fn$
  select exists(select 1 from devices d join members m on m.id = d.member_id
                where d.auth_uid = auth.uid() and m.role = 'admin')
$fn$;

-- Brute-force protection: failed code / PIN attempts are logged and limited.
create table if not exists auth_attempts (
  id bigserial primary key,
  auth_uid uuid,
  member_id uuid,
  kind text not null,               -- 'code' | 'pin'
  at timestamptz not null default now()
);
alter table auth_attempts enable row level security;
create index if not exists auth_attempts_idx on auth_attempts (kind, at);

create or replace function too_many_attempts(p_kind text, p_member uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $fn$
  select case when p_kind = 'pin'
    then (select count(*) from auth_attempts where kind = 'pin' and member_id = p_member and at > now() - interval '15 minutes') >= 5
    else (select count(*) from auth_attempts where kind = 'code' and auth_uid = auth.uid() and at > now() - interval '15 minutes') >= 10
  end
$fn$;

-- Public (pre-login) roster: only nickname + avatar, after checking the group code.
-- Wrong code → empty result (and the attempt is logged; 10 wrong codes in 15 min → 'massa_intents').
drop function if exists roster_for_code(text);
create or replace function roster_for_code(p_code text)
returns table(id uuid, nickname text, avatar_data text, has_pin boolean)
language plpgsql volatile security definer set search_path = public, extensions as $fn$
begin
  if auth.uid() is null then raise exception 'no_auth'; end if;
  if too_many_attempts('code', null) then raise exception 'massa_intents'; end if;
  if not exists(select 1 from app_config where group_code_hash = crypt(p_code, group_code_hash)) then
    insert into auth_attempts(auth_uid, kind) values (auth.uid(), 'code');
    return;
  end if;
  return query
    select m.id, m.nickname, m.avatar_data, (s.member_id is not null)
    from members m left join member_secrets s on s.member_id = m.id
    where m.active order by m.sort_order, m.nickname;
end $fn$;

-- Join: first time sets the PIN, afterwards verifies it. Binds this anonymous auth user to the member.
-- Wrong PIN → returns null (attempt logged; 5 wrong PINs for a member in 15 min → 'massa_intents').
create or replace function join_group(p_code text, p_member uuid, p_pin text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_hash text;
begin
  if auth.uid() is null then raise exception 'no_auth'; end if;
  if not exists(select 1 from app_config where group_code_hash = crypt(p_code, group_code_hash)) then
    raise exception 'codi_incorrecte';
  end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'pin_invalid'; end if;
  if not exists(select 1 from members where id = p_member and active) then raise exception 'membre_desconegut'; end if;
  if too_many_attempts('pin', p_member) then raise exception 'massa_intents'; end if;
  select pin_hash into v_hash from member_secrets where member_id = p_member;
  if v_hash is null then
    insert into member_secrets(member_id, pin_hash) values (p_member, crypt(p_pin, gen_salt('bf')));
  elsif v_hash <> crypt(p_pin, v_hash) then
    insert into auth_attempts(auth_uid, member_id, kind) values (auth.uid(), p_member, 'pin');
    return null;
  end if;
  insert into devices(auth_uid, member_id) values (auth.uid(), p_member)
    on conflict (auth_uid) do update set member_id = excluded.member_id, created_at = now();
  return p_member;
end $fn$;

create or replace function leave_group() returns void
language sql security definer set search_path = public, extensions as $fn$
  delete from devices where auth_uid = auth.uid()
$fn$;

create or replace function admin_reset_pin(p_member uuid) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not is_admin() then raise exception 'nomes_admin'; end if;
  delete from member_secrets where member_id = p_member;
  delete from devices where member_id = p_member;
  delete from auth_attempts where member_id = p_member;
end $fn$;

create or replace function admin_set_group_code(p_code text) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not is_admin() then raise exception 'nomes_admin'; end if;
  update app_config set group_code_hash = crypt(p_code, gen_salt('bf')) where id = 1;
end $fn$;

-- ───────────────────────── Audit trigger ─────────────────────────
create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_id text;
begin
  v_id := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id',
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'meetup_id');
  insert into audit_log(actor_id, entity, entity_id, action, before, after)
  values (current_member(), tg_table_name, v_id, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'avatar_data' end,
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'avatar_data' end);
  return coalesce(new, old);
end $fn$;

do $fn$ declare t text; begin
  foreach t in array array['members','member_kids','att_event_types','att_meetups','att_attendance','att_adjustments'] loop
    execute format('drop trigger if exists audit_%1$s on %1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_trigger()', t);
  end loop;
end $fn$;

-- ───────────────────────── Tier RPCs ─────────────────────────
create or replace function tier_create(p_placements jsonb, p_categories text[], p_real_index int)
returns uuid
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member(); v_id uuid; v_n int := array_length(p_categories, 1);
        v_order int[]; v_shuffled jsonb := '[]'; v_new_real int; i int;
begin
  if v_me is null then raise exception 'no_membre'; end if;
  if v_n is null or v_n < 3 or v_n > 5 then raise exception 'cal_3_a_5_categories'; end if;
  if p_real_index < 0 or p_real_index >= v_n then raise exception 'index_invalid'; end if;
  -- server-side shuffle so the creator's input order leaks nothing
  select array_agg(x order by random()) into v_order from generate_series(1, v_n) x;
  for i in 1..v_n loop
    v_shuffled := v_shuffled || to_jsonb(trim(p_categories[v_order[i]]));
    if v_order[i] = p_real_index + 1 then v_new_real := i - 1; end if;
  end loop;
  insert into tier_games(placements, candidates) values (p_placements, v_shuffled) returning id into v_id;
  insert into tier_secrets(game_id, creator_id, real_index) values (v_id, v_me, v_new_real);
  return v_id;
end $fn$;

-- Returns my status for every game: whether I'm the creator / already guessed, plus the answer when allowed.
create or replace function tier_my_games()
returns table(game_id uuid, is_creator boolean, my_category int, my_creator_guess uuid,
              real_index int, creator_id uuid, guesses int, correct int)
language sql stable security definer set search_path = public, extensions as $fn$
  select g.id,
         s.creator_id = current_member(),
         mg.category_index, mg.creator_guess_id,
         case when s.creator_id = current_member() or mg.member_id is not null then s.real_index end,
         case when s.creator_id = current_member() or mg.member_id is not null then s.creator_id end,
         (select count(*)::int from tier_guesses x where x.game_id = g.id),
         (select count(*)::int from tier_guesses x where x.game_id = g.id and x.correct_category)
  from tier_games g
  join tier_secrets s on s.game_id = g.id
  left join tier_guesses mg on mg.game_id = g.id and mg.member_id = current_member()
  where is_member()
$fn$;

create or replace function tier_guess(p_game uuid, p_category int, p_creator uuid)
returns table(real_index int, creator_id uuid, correct_category boolean, correct_creator boolean)
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member(); s tier_secrets;
begin
  if v_me is null then raise exception 'no_membre'; end if;
  select * into s from tier_secrets where game_id = p_game;
  if not found then raise exception 'joc_desconegut'; end if;
  if s.creator_id = v_me then raise exception 'ets_el_creador'; end if;
  if exists(select 1 from tier_guesses where game_id = p_game and member_id = v_me) then
    raise exception 'ja_has_votat';
  end if;
  insert into tier_guesses(game_id, member_id, category_index, creator_guess_id, correct_category, correct_creator)
  values (p_game, v_me, p_category, p_creator, p_category = s.real_index, p_creator = s.creator_id);
  return query select s.real_index, s.creator_id, p_category = s.real_index, p_creator = s.creator_id;
end $fn$;

-- Leaderboard: +3 right category, +2 right creator; creator +3 if some-but-not-all guessed the category.
create or replace function tier_leaderboard()
returns table(member_id uuid, points int, games_played int, games_created int)
language sql stable security definer set search_path = public, extensions as $fn$
  with guess_pts as (
    select member_id, sum((case when correct_category then 3 else 0 end) + (case when correct_creator then 2 else 0 end))::int pts,
           count(*)::int n
    from tier_guesses group by member_id
  ), creator_pts as (
    select s.creator_id member_id,
           sum(case when c.n > 0 and c.ok > 0 and c.ok < c.n then 3 else 0 end)::int pts,
           count(*)::int n
    from tier_secrets s
    left join lateral (select count(*) n, count(*) filter (where correct_category) ok
                       from tier_guesses g where g.game_id = s.game_id) c on true
    group by s.creator_id
  )
  select m.id, coalesce(g.pts,0) + coalesce(c.pts,0), coalesce(g.n,0), coalesce(c.n,0)
  from members m left join guess_pts g on g.member_id = m.id left join creator_pts c on c.member_id = m.id
  where is_member() and m.active
$fn$;

create or replace function tier_delete(p_game uuid) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not (is_admin() or exists(select 1 from tier_secrets where game_id = p_game and creator_id = current_member())) then
    raise exception 'no_permis';
  end if;
  delete from tier_games where id = p_game;
end $fn$;

-- ───────────────────────── RLS ─────────────────────────
alter table app_config enable row level security;
alter table members enable row level security;
alter table member_secrets enable row level security;
alter table devices enable row level security;
alter table member_kids enable row level security;
alter table audit_log enable row level security;
alter table att_event_types enable row level security;
alter table att_meetups enable row level security;
alter table att_attendance enable row level security;
alter table att_adjustments enable row level security;
alter table tier_games enable row level security;
alter table tier_secrets enable row level security;
alter table tier_guesses enable row level security;
-- app_config, member_secrets, devices, tier_secrets, tier_guesses: no policies → only via RPCs.

do $fn$ declare t text; begin
  foreach t in array array['members','member_kids','audit_log','att_event_types','att_meetups','att_attendance','att_adjustments','tier_games'] loop
    execute format('drop policy if exists "%1$s_read" on %1$s', t);
    execute format('create policy "%1$s_read" on %1$s for select using (is_member())', t);
  end loop;
end $fn$;

-- Admin-only writes
do $fn$ declare t text; begin
  foreach t in array array['members','member_kids','att_event_types'] loop
    execute format('drop policy if exists "%1$s_admin" on %1$s', t);
    execute format('create policy "%1$s_admin" on %1$s for all using (is_admin()) with check (is_admin())', t);
  end loop;
end $fn$;

-- Meetups: any member creates; creator or admin edits/deletes
drop policy if exists att_meetups_ins on att_meetups;
create policy att_meetups_ins on att_meetups for insert with check (is_member() and created_by = current_member());
drop policy if exists att_meetups_upd on att_meetups;
create policy att_meetups_upd on att_meetups for update using (is_admin() or created_by = current_member());
drop policy if exists att_meetups_del on att_meetups;
create policy att_meetups_del on att_meetups for delete using (is_admin() or created_by = current_member());

create or replace function can_edit_meetup(p_meetup uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $fn$
  select is_admin() or exists(select 1 from att_meetups where id = p_meetup and created_by = current_member())
$fn$;
drop policy if exists att_attendance_write on att_attendance;
create policy att_attendance_write on att_attendance for all
  using (can_edit_meetup(meetup_id)) with check (can_edit_meetup(meetup_id));

-- Adjustments: any member adds; creator or admin removes
drop policy if exists att_adj_ins on att_adjustments;
create policy att_adj_ins on att_adjustments for insert with check (is_member() and created_by = current_member());
drop policy if exists att_adj_upd on att_adjustments;
create policy att_adj_upd on att_adjustments for update using (is_admin() or created_by = current_member());
drop policy if exists att_adj_del on att_adjustments;
create policy att_adj_del on att_adjustments for delete using (is_admin() or created_by = current_member());

-- Allow PostgREST roles to call functions / touch tables (RLS still applies)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;
revoke all on app_config, member_secrets, devices, tier_secrets, auth_attempts from anon, authenticated;

-- ───────────────────────── Seeds (event types) ─────────────────────────
insert into att_event_types(name, emoji, rule, sort_order)
select * from (values
  ('Cervesa', '🍺', '{"kind":"fixed","points":1}'::jsonb, 1),
  ('Veure el Barça', '⚽', '{"kind":"fixed","points":1}'::jsonb, 2),
  ('Festa', '🎉', '{"kind":"sleep_hours","per_hour":1}'::jsonb, 3),
  ('Pàdel', '🎾', '{"kind":"win","points":1}'::jsonb, 4),
  ('Bicicleta', '🚴', '{"kind":"meet_time","cutoff":"09:00","early":-3,"late":-1}'::jsonb, 5),
  ('Pla de cap de setmana', '🏕️', '{"kind":"fixed","points":10}'::jsonb, 6)
) v(name, emoji, rule, sort_order)
where not exists (select 1 from att_event_types);

-- ───────────────────────── No diguis el mateix (nm_) ─────────────────────────
-- A creator answers 5 random questions (4 options each). Each other member then answers the same
-- questions one by one; the moment they pick the same option as the creator, they lose.
create table if not exists nm_matches (
  id uuid primary key default gen_random_uuid(),
  items jsonb not null,               -- [{"q":"q07","options":["a","b","c","d"]}, ...] (member ids for face questions)
  created_at timestamptz not null default now()
);
create table if not exists nm_secrets (
  match_id uuid primary key references nm_matches(id) on delete cascade,
  creator_id uuid not null references members(id),
  answers int[] not null
);
create table if not exists nm_plays (
  match_id uuid not null references nm_matches(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  answers int[] not null default '{}',
  lost_at int,                        -- question index where they matched the creator
  finished boolean not null default false,
  at timestamptz not null default now(),
  primary key (match_id, member_id)
);
alter table nm_matches enable row level security;
alter table nm_secrets enable row level security;
alter table nm_plays enable row level security;
drop policy if exists "nm_matches_read" on nm_matches;
create policy "nm_matches_read" on nm_matches for select using (is_member());
grant select, insert, update, delete on nm_matches, nm_secrets, nm_plays to authenticated;
revoke all on nm_secrets, nm_plays from anon, authenticated;

create or replace function nm_create(p_items jsonb, p_answers int[]) returns uuid
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member(); v_id uuid; n int := jsonb_array_length(p_items);
begin
  if v_me is null then raise exception 'no_membre'; end if;
  if n < 1 or n > 10 or array_length(p_answers, 1) is distinct from n then raise exception 'respostes_incompletes'; end if;
  insert into nm_matches(items) values (p_items) returning id into v_id;
  insert into nm_secrets(match_id, creator_id, answers) values (v_id, v_me, p_answers);
  return v_id;
end $fn$;

-- Answer the next question. Returns whether it matched the creator (=> lost) and the creator's pick.
create or replace function nm_answer(p_match uuid, p_q int, p_option int)
returns table(same boolean, creator_option int, done boolean, won boolean)
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member(); s nm_secrets; p nm_plays; n int; v_same boolean;
begin
  if v_me is null then raise exception 'no_membre'; end if;
  select * into s from nm_secrets where match_id = p_match;
  if not found then raise exception 'joc_desconegut'; end if;
  if s.creator_id = v_me then raise exception 'ets_el_creador'; end if;
  n := array_length(s.answers, 1);
  insert into nm_plays(match_id, member_id) values (p_match, v_me) on conflict do nothing;
  select * into p from nm_plays where match_id = p_match and member_id = v_me for update;
  if p.finished then raise exception 'ja_has_votat'; end if;
  if p_q <> coalesce(array_length(p.answers, 1), 0) then raise exception 'ordre_incorrecte'; end if;
  v_same := s.answers[p_q + 1] = p_option;
  update nm_plays set answers = answers || p_option,
         lost_at = case when v_same then p_q end,
         finished = v_same or p_q + 1 = n, at = now()
   where match_id = p_match and member_id = v_me;
  return query select v_same, s.answers[p_q + 1], v_same or p_q + 1 = n, (not v_same) and p_q + 1 = n;
end $fn$;

-- My view of every match: role, progress, counts. Creator answers only when I'm the creator or I've finished.
create or replace function nm_my_matches()
returns table(match_id uuid, is_creator boolean, creator_id uuid, my_answers int[], my_finished boolean, my_lost_at int,
              creator_answers int[], players int, winners int)
language sql stable security definer set search_path = public, extensions as $fn$
  select m.id, s.creator_id = current_member(),
         case when s.creator_id = current_member() or coalesce(p.finished, false) then s.creator_id end,
         p.answers, coalesce(p.finished, false), p.lost_at,
         case when s.creator_id = current_member() or coalesce(p.finished, false) then s.answers end,
         (select count(*)::int from nm_plays x where x.match_id = m.id and x.finished),
         (select count(*)::int from nm_plays x where x.match_id = m.id and x.finished and x.lost_at is null)
  from nm_matches m join nm_secrets s on s.match_id = m.id
  left join nm_plays p on p.match_id = m.id and p.member_id = current_member()
  where is_member()
$fn$;

-- Everyone's results for a match, only once I'm allowed to see the answers.
create or replace function nm_results(p_match uuid)
returns table(member_id uuid, answers int[], lost_at int, finished boolean)
language sql stable security definer set search_path = public, extensions as $fn$
  select p.member_id, p.answers, p.lost_at, p.finished from nm_plays p
  where p.match_id = p_match and p.finished and is_member()
    and exists(select 1 from nm_secrets s left join nm_plays me on me.match_id = s.match_id and me.member_id = current_member()
               where s.match_id = p_match and (s.creator_id = current_member() or coalesce(me.finished, false)))
$fn$;

-- Leaderboard: +3 per win as player; creator +1 for every player who fell in their trap.
create or replace function nm_leaderboard()
returns table(member_id uuid, points int, wins int, played int, trapped int)
language sql stable security definer set search_path = public, extensions as $fn$
  with pl as (select member_id, count(*) filter (where lost_at is null)::int wins, count(*)::int played
              from nm_plays where finished group by member_id),
       cr as (select s.creator_id member_id, count(p.*) filter (where p.lost_at is not null)::int trapped
              from nm_secrets s join nm_plays p on p.match_id = s.match_id and p.finished group by s.creator_id)
  select m.id, coalesce(pl.wins,0)*3 + coalesce(cr.trapped,0), coalesce(pl.wins,0), coalesce(pl.played,0), coalesce(cr.trapped,0)
  from members m left join pl on pl.member_id = m.id left join cr on cr.member_id = m.id
  where is_member() and m.active
$fn$;

create or replace function nm_delete(p_match uuid) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not (is_admin() or exists(select 1 from nm_secrets where match_id = p_match and creator_id = current_member())) then
    raise exception 'no_permis';
  end if;
  delete from nm_matches where id = p_match;
end $fn$;

grant execute on all functions in schema public to anon, authenticated;

-- ───────────────────────── Fill de puta o Subnormal (fs_) ─────────────────────────
-- Once per day (Europe/Madrid), each member rates every other member on one 0–10 scale:
-- 10 = fill de puta, 0 = subnormal (sub = 10 − fdp). One vote per target per day, never yourself. Votes are public.
-- A member's fdp % = average fdp received / 10; subnormal % = 100 − fdp %.
create table if not exists fs_votes (
  id uuid primary key default gen_random_uuid(),
  day date not null default ((now() at time zone 'Europe/Madrid')::date),
  voter_id uuid not null references members(id) on delete cascade,
  target_id uuid not null references members(id) on delete cascade,
  fdp smallint not null check (fdp between 0 and 10),
  sub smallint not null check (sub between 0 and 10),
  created_at timestamptz not null default now(),
  unique (day, voter_id, target_id),
  check (voter_id <> target_id)
);
create index if not exists fs_votes_target on fs_votes(target_id, day);
alter table fs_votes enable row level security;
drop policy if exists "fs_votes_read" on fs_votes;
create policy "fs_votes_read" on fs_votes for select using (is_member());
grant select on fs_votes to authenticated;
revoke insert, update, delete on fs_votes from anon, authenticated;

-- Cast today's votes: p_votes = [{"target": uuid, "fdp": 0..10}, ...] (sub is derived as 10 − fdp)
create or replace function fs_vote(p_votes jsonb) returns int
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member(); v_day date := (now() at time zone 'Europe/Madrid')::date; v jsonb; n int := 0;
begin
  if v_me is null or not is_member() then raise exception 'no_membre'; end if;
  if jsonb_typeof(p_votes) <> 'array' or jsonb_array_length(p_votes) = 0 then raise exception 'vot_invalid'; end if;
  for v in select * from jsonb_array_elements(p_votes) loop
    if (v->>'target')::uuid = v_me then raise exception 'vot_a_tu_mateix'; end if;
    if not exists(select 1 from members where id = (v->>'target')::uuid and active) then raise exception 'membre_desconegut'; end if;
    if (v->>'fdp')::int not between 0 and 10 then raise exception 'vot_invalid'; end if;
    if exists(select 1 from fs_votes where day = v_day and voter_id = v_me and target_id = (v->>'target')::uuid) then
      raise exception 'ja_votat_avui';
    end if;
    insert into fs_votes(day, voter_id, target_id, fdp, sub)
    values (v_day, v_me, (v->>'target')::uuid, (v->>'fdp')::int, 10 - (v->>'fdp')::int);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- Ranking since p_from (null = always): average received points as %, and number of votes.
create or replace function fs_ranking(p_from date default null)
returns table(member_id uuid, fdp_pct numeric, sub_pct numeric, votes int)
language sql stable security definer set search_path = public, extensions as $fn$
  select m.id, round(avg(v.fdp) * 10, 1), round(avg(v.sub) * 10, 1), count(v.id)::int
  from members m left join fs_votes v on v.target_id = m.id and (p_from is null or v.day >= p_from)
  where is_member() and m.active
  group by m.id
$fn$;

-- Admin can delete a vote (e.g. a mistake).
create or replace function fs_delete(p_vote uuid) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not is_admin() then raise exception 'nomes_admin'; end if;
  delete from fs_votes where id = p_vote;
end $fn$;

grant execute on function fs_vote(jsonb), fs_ranking(date), fs_delete(uuid) to authenticated;
