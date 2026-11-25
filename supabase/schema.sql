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

-- My view of every match: role, creator, progress, counts. Creator answers only when I'm the creator or I've finished.
create or replace function nm_my_matches()
returns table(match_id uuid, is_creator boolean, creator_id uuid, my_answers int[], my_finished boolean, my_lost_at int,
              creator_answers int[], players int, winners int)
language sql stable security definer set search_path = public, extensions as $fn$
  select m.id, s.creator_id = current_member(),
         s.creator_id,                       -- everyone sees who made the match
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

-- ============ Keepalive ============
-- Pinged by .github/workflows/keepalive.yml every 3 days so the free-tier project doesn't pause.
-- Harmless: reads nothing, returns 1.
create or replace function keepalive() returns int
language sql stable as $fn$ select 1 $fn$;

grant execute on function keepalive() to anon, authenticated;

-- ───────────────────────── Enquesta del dia (eq_) ─────────────────────────
-- One question per day (Europe/Madrid), the same for everyone, 4 options, one answer per member.
-- The day's question is fixed the first time anyone asks for it: oldest question in the members' queue,
-- otherwise one from the house bank (the least recently used, random among ties).
-- Answers are public, but you only see them once you've answered (or the day is over).
create table if not exists eq_bank (
  id int primary key,
  question text not null,
  options text[] not null check (array_length(options, 1) = 4)
);
create table if not exists eq_queue (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references members(id) on delete cascade,
  question text not null check (length(question) between 3 and 200),
  options text[] not null check (array_length(options, 1) = 4),
  created_at timestamptz not null default now(),
  used_on date unique                 -- null = still waiting in the queue
);
create table if not exists eq_days (
  day date primary key,
  question text not null,
  options text[] not null,
  author_id uuid references members(id) on delete set null,   -- null = house question
  queue_id uuid references eq_queue(id) on delete set null,
  bank_id int references eq_bank(id),
  created_at timestamptz not null default now()
);
create table if not exists eq_votes (
  day date not null references eq_days(day) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  option smallint not null check (option between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (day, member_id)
);
alter table eq_bank enable row level security;
alter table eq_queue enable row level security;
alter table eq_days enable row level security;
alter table eq_votes enable row level security;
-- No direct table access: everything goes through the functions below.
revoke all on eq_bank, eq_queue, eq_days, eq_votes from anon, authenticated;

insert into eq_bank(id, question, options) values
  (1, 'Si demà et toquen 100.000 €, què fas primer?', array['Deixo la feina', 'Viatge amb el grup', 'Amortitzo hipoteca', 'No ho dic a ningú']),
  (2, 'Quin superpoder triaries?', array['Volar', 'Llegir ments', 'Dormir 2 h i estar com nou', 'Teletransport al bar']),
  (3, 'Quin és el millor moment per a una cervesa?', array['Esmorzar', 'Vermut', 'Sortint de la feina', 'Sempre']),
  (4, 'Truita de patates:', array['Amb ceba', 'Sense ceba', 'Poc feta, que regalimi', 'Ben cuita i seca']),
  (5, 'Què és pitjor?', array['Ressaca de dissabte', 'Nen despert a les 6', 'Reunió a les 8', 'Dilluns sense cafè']),
  (6, 'Si haguessis de viure dins d''una sèrie…', array['Els Simpsons', 'Joc de Trons', 'Plats Bruts', 'The Office']),
  (7, 'A quina hora vas a dormir un dissabte normal?', array['Abans de les 12', 'Cap a les 2', 'Quan surt el sol', 'A les 10 al sofà']),
  (8, 'Qui és el pitjor company de viatge?', array['El que ronca', 'El que mai paga', 'El que vol fer turisme a les 8', 'El que es perd']),
  (9, 'On hauria de ser la propera escapada del grup?', array['Muntanya', 'Platja', 'Ciutat europea', 'Casa rural amb barbacoa']),
  (10, 'Què et fa més ràbia?', array['Àudios de 5 minuts', 'Gent que parla al cine', 'Que et diguin "relaxa''t"', 'Cues al súper']),
  (11, 'Millor esmorzar de forquilla?', array['Cap i pota', 'Botifarra amb mongetes', 'Fricandó', 'Peus de porc']),
  (12, 'Quant tardes a contestar un WhatsApp?', array['Al moment', 'Una hora', 'Un dia', 'El deixo en vist']),
  (13, 'Vacances ideals:', array['Tot inclòs sense moure''m', 'Ruta d''aventura', 'Festival de música', 'A casa i sense nens']),
  (14, 'Si tornessis a tenir 18 anys…', array['Estudiaria una altra cosa', 'Sortiria encara més', 'Estalviaria', 'Faria exactament el mateix']),
  (15, 'El teu plat estrella a la cuina:', array['Pasta', 'Barbacoa', 'Ous ferrats', 'Trucar al Glovo']),
  (16, 'Què prefereixes?', array['Mai més cervesa', 'Mai més futbol', 'Mai més formatge', 'Mai més vacances']),
  (17, 'Com arribes a les quedades?', array['10 minuts abans', 'Puntual', '15 minuts tard', '"Ja surto" i encara a la dutxa']),
  (18, 'Un dissabte a la nit perfecte:', array['Sopar i a dormir', 'Copes fins tard', 'Sofà i peli', 'Jocs de taula']),
  (19, 'Quin invent és el més important de la història?', array['La roda', 'Internet', 'La cervesa', 'El rentaplats']),
  (20, 'A quina edat es deixa de ser jove?', array['30', '40', '50', 'Mai: som joves (però no tant)']),
  (21, 'Arriba el compte del sopar. Què fas?', array['Pago jo', 'A parts iguals', 'Cadascú el seu', 'Me''n vaig al lavabo']),
  (22, 'La pitjor feina de casa:', array['Planxar', 'Netejar el lavabo', 'Estendre la roba', 'Buidar el rentaplats']),
  (23, 'El teu superpoder en una festa:', array['Ballar', 'Fer de DJ', 'Aguantar fins al final', 'Marxar sense dir adéu']),
  (24, 'El millor moment de la setmana:', array['Divendres a la tarda', 'Dissabte al matí', 'Diumenge al vespre', 'Dilluns (mentida)']),
  (25, 'Si poguessis sopar amb algú famós…', array['Messi', 'Pep Guardiola', 'Rosalía', 'Andreu Buenafuente']),
  (26, 'Quin animal series?', array['Gos fidel', 'Gat independent', 'Mandrós', 'Porc senglar de nit']),
  (27, 'La teva relació amb el gimnàs:', array['Hi vaig cada dia', 'Pago però no hi vaig', 'El meu gimnàs és el pàdel', 'Què és un gimnàs?']),
  (28, 'Pa amb tomàquet:', array['Sol, amb oli i sal', 'Amb pernil', 'Amb fuet', 'No en menjo (monstre)']),
  (29, 'Qui creus que guanyarà la lliga?', array['Barça', 'Madrid', 'Atlètic', 'M''és igual, jo vull cervesa']),
  (30, 'Si el grup fes un viatge sense parelles ni nens…', array['Hi vaig de cap', 'Ho he de consultar', 'Només un cap de setmana', 'No em deixaran mai'])
on conflict (id) do update set question = excluded.question, options = excluded.options;

create or replace function eq_today_date() returns date
language sql stable as $fn$ select (now() at time zone 'Europe/Madrid')::date $fn$;

-- Internal: make sure p_day has its question (not callable from the app).
create or replace function eq_ensure_day(p_day date) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare q eq_queue; b eq_bank;
begin
  if exists(select 1 from eq_days where day = p_day) then return; end if;
  perform pg_advisory_xact_lock(hashtext('eq_ensure_day'));
  if exists(select 1 from eq_days where day = p_day) then return; end if;
  select * into q from eq_queue where used_on is null order by created_at limit 1;
  if found then
    update eq_queue set used_on = p_day where id = q.id;
    insert into eq_days(day, question, options, author_id, queue_id) values (p_day, q.question, q.options, q.author_id, q.id);
  else
    select k.* into b from eq_bank k
      left join (select bank_id, max(day) last from eq_days where bank_id is not null group by bank_id) u on u.bank_id = k.id
      order by u.last nulls first, random() limit 1;
    insert into eq_days(day, question, options, bank_id) values (p_day, b.question, b.options, b.id);
  end if;
end $fn$;
revoke execute on function eq_ensure_day(date) from public, anon, authenticated;

-- Today's question + my answer + how many answered + queue length.
create or replace function eq_state() returns jsonb
language plpgsql security definer set search_path = public, extensions as $fn$
declare d eq_days; v_day date := eq_today_date();
begin
  if not is_member() then raise exception 'no_membre'; end if;
  perform eq_ensure_day(v_day);
  select * into d from eq_days where day = v_day;
  return jsonb_build_object(
    'day', d.day, 'question', d.question, 'options', to_jsonb(d.options), 'author_id', d.author_id,
    'my_vote', (select option from eq_votes where day = v_day and member_id = current_member()),
    'answers', (select count(*) from eq_votes where day = v_day),
    'pending', (select count(*) from eq_queue where used_on is null));
end $fn$;

create or replace function eq_vote(p_option int) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member(); v_day date := eq_today_date();
begin
  if v_me is null or not is_member() then raise exception 'no_membre'; end if;
  if p_option not between 0 and 3 then raise exception 'vot_invalid'; end if;
  perform eq_ensure_day(v_day);
  if exists(select 1 from eq_votes where day = v_day and member_id = v_me) then raise exception 'ja_respost_avui'; end if;
  insert into eq_votes(day, member_id, option) values (v_day, v_me, p_option);
end $fn$;

-- Who answered what on p_day: only once I've answered it, or the day is over.
create or replace function eq_results(p_day date) returns table(member_id uuid, option int)
language sql stable security definer set search_path = public, extensions as $fn$
  select v.member_id, v.option::int from eq_votes v
  where v.day = p_day and is_member()
    and (p_day < eq_today_date() or exists(select 1 from eq_votes x where x.day = p_day and x.member_id = current_member()))
  order by v.created_at
$fn$;

-- Past days (newest first) with vote counts per option.
create or replace function eq_history(p_limit int default 30)
returns table(day date, question text, options text[], author_id uuid, counts int[], my_vote int)
language sql stable security definer set search_path = public, extensions as $fn$
  select d.day, d.question, d.options, d.author_id,
         array(select (select count(*)::int from eq_votes v where v.day = d.day and v.option = i) from generate_series(0, 3) i),
         (select option::int from eq_votes v where v.day = d.day and v.member_id = current_member())
  from eq_days d
  where d.day < eq_today_date() and is_member()
  order by d.day desc limit least(greatest(p_limit, 1), 200)
$fn$;

-- Queued questions I can see (mine; all of them if admin), with their place in the queue (1 = next).
create or replace function eq_queue_list()
returns table(id uuid, author_id uuid, question text, options text[], created_at timestamptz, queue_pos int)
language sql stable security definer set search_path = public, extensions as $fn$
  select * from (
    select q.id, q.author_id, q.question, q.options, q.created_at, (row_number() over (order by q.created_at))::int
    from eq_queue q where q.used_on is null
  ) t where is_member() and (t.author_id = current_member() or is_admin())
  order by 6
$fn$;

create or replace function eq_add(p_question text, p_options text[]) returns uuid
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member(); v_id uuid; v_opts text[];
begin
  if v_me is null or not is_member() then raise exception 'no_membre'; end if;
  select array_agg(btrim(o) order by n) into v_opts from unnest(p_options) with ordinality as t(o, n);
  if length(btrim(coalesce(p_question, ''))) not between 3 and 200
     or coalesce(array_length(v_opts, 1), 0) <> 4
     or exists(select 1 from unnest(v_opts) o where length(o) not between 1 and 80)
     or (select count(distinct lower(o)) from unnest(v_opts) o) <> 4 then
    raise exception 'pregunta_invalida';
  end if;
  if (select count(*) from eq_queue where author_id = v_me and used_on is null) >= 10 then raise exception 'massa_preguntes'; end if;
  insert into eq_queue(author_id, question, options) values (v_me, btrim(p_question), v_opts) returning id into v_id;
  return v_id;
end $fn$;

-- Remove a question still waiting in the queue (author or admin).
create or replace function eq_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not exists(select 1 from eq_queue where id = p_id and used_on is null and (author_id = current_member() or is_admin())) then
    raise exception 'no_permis';
  end if;
  delete from eq_queue where id = p_id;
end $fn$;

grant execute on function eq_state(), eq_vote(int), eq_results(date), eq_history(int), eq_queue_list(),
  eq_add(text, text[]), eq_delete(uuid) to authenticated;

-- ───────────────────────── Push notifications (push_) ─────────────────────────
-- Each device that turns notifications on stores its Web Push subscription here.
-- The sender (.github/workflows/push.yml) authenticates with a secret token whose sha256 lives in push_config
-- (set by hand with psql, never committed).
create table if not exists push_subs (
  endpoint text primary key,
  member_id uuid not null references members(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create table if not exists push_config (
  id int primary key default 1 check (id = 1),
  token_hash text not null
);
create table if not exists push_log (
  day date not null,
  slot text not null,
  sent_at timestamptz not null default now(),
  primary key (day, slot)
);
alter table push_subs enable row level security;
alter table push_config enable row level security;
alter table push_log enable row level security;
revoke all on push_subs, push_config, push_log from anon, authenticated;

create or replace function push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_me uuid := current_member();
begin
  if v_me is null or not is_member() then raise exception 'no_membre'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'subscripcio_invalida';
  end if;
  insert into push_subs(endpoint, member_id, p256dh, auth) values (p_endpoint, v_me, p_p256dh, p_auth)
  on conflict (endpoint) do update set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $fn$;

create or replace function push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public, extensions as $fn$
  delete from push_subs where endpoint = p_endpoint and member_id = current_member()
$fn$;

create or replace function push_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public, extensions as $fn$
  select exists(select 1 from push_config where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex'))
$fn$;
revoke execute on function push_token_ok(text) from public, anon, authenticated;

-- For the sender: today's notification for p_slot ('mati' | 'vespre' | 'prova') and who gets it.
-- Returns null if that slot was already sent today. 'vespre' skips members who already answered.
create or replace function push_job(p_token text, p_slot text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $fn$
declare v_day date := eq_today_date(); d eq_days; v_title text; v_body text;
begin
  if not push_token_ok(p_token) then raise exception 'no_permis'; end if;
  if p_slot not in ('mati', 'vespre', 'prova') then raise exception 'slot_invalid'; end if;
  if p_slot <> 'prova' and exists(select 1 from push_log where day = v_day and slot = p_slot) then return null; end if;
  perform eq_ensure_day(v_day);
  select * into d from eq_days where day = v_day;
  v_title := case p_slot when 'mati' then '🗳️ Enquesta del dia'
                         when 'vespre' then '⏰ Encara no has respost l''enquesta!'
                         else '🔔 Prova de notificació' end;
  v_body := d.question || E'\n' || array_to_string(d.options, ' · ');
  return jsonb_build_object('title', v_title, 'body', v_body, 'url', './#/enquesta', 'tag', 'eq-' || v_day,
    'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                      from push_subs s join members m on m.id = s.member_id and m.active
                      where p_slot <> 'vespre' or not exists(select 1 from eq_votes v where v.day = v_day and v.member_id = s.member_id)),
                     '[]'::jsonb));
end $fn$;

create or replace function push_done(p_token text, p_slot text) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not push_token_ok(p_token) then raise exception 'no_permis'; end if;
  if p_slot = 'prova' then return; end if;
  insert into push_log(day, slot) values (eq_today_date(), p_slot) on conflict do nothing;
end $fn$;

-- Sender reports a dead subscription (HTTP 404/410 from the push service).
create or replace function push_gone(p_token text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, extensions as $fn$
begin
  if not push_token_ok(p_token) then raise exception 'no_permis'; end if;
  delete from push_subs where endpoint = p_endpoint;
end $fn$;

grant execute on function push_subscribe(text, text, text), push_unsubscribe(text) to authenticated;
grant execute on function push_job(text, text), push_done(text, text), push_gone(text, text) to anon, authenticated;
