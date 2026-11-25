-- Som joves però no tant — Supabase schema
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent where possible).
-- Requires: Authentication → Sign In / Providers → "Allow anonymous sign-ins" ON.

create extension if not exists pgcrypto;

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
language sql stable security definer set search_path = public as $$
  select member_id from devices where auth_uid = auth.uid()
$$;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from devices d join members m on m.id = d.member_id
                where d.auth_uid = auth.uid() and m.active)
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from devices d join members m on m.id = d.member_id
                where d.auth_uid = auth.uid() and m.role = 'admin')
$$;

-- Public (pre-login) roster: only nickname + avatar, after checking the group code.
create or replace function roster_for_code(p_code text)
returns table(id uuid, nickname text, avatar_data text, has_pin boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists(select 1 from app_config where group_code_hash = crypt(p_code, group_code_hash)) then
    raise exception 'codi_incorrecte';
  end if;
  return query
    select m.id, m.nickname, m.avatar_data, (s.member_id is not null)
    from members m left join member_secrets s on s.member_id = m.id
    where m.active order by m.sort_order, m.nickname;
end $$;

-- Join: first time sets the PIN, afterwards verifies it. Binds this anonymous auth user to the member.
create or replace function join_group(p_code text, p_member uuid, p_pin text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_hash text;
begin
  if auth.uid() is null then raise exception 'no_auth'; end if;
  if not exists(select 1 from app_config where group_code_hash = crypt(p_code, group_code_hash)) then
    raise exception 'codi_incorrecte';
  end if;
  if p_pin !~ '^[0-9]{4}$' then raise exception 'pin_invalid'; end if;
  if not exists(select 1 from members where id = p_member and active) then raise exception 'membre_desconegut'; end if;
  select pin_hash into v_hash from member_secrets where member_id = p_member;
  if v_hash is null then
    insert into member_secrets(member_id, pin_hash) values (p_member, crypt(p_pin, gen_salt('bf')));
  elsif v_hash <> crypt(p_pin, v_hash) then
    raise exception 'pin_incorrecte';
  end if;
  insert into devices(auth_uid, member_id) values (auth.uid(), p_member)
    on conflict (auth_uid) do update set member_id = excluded.member_id, created_at = now();
  return p_member;
end $$;

create or replace function leave_group() returns void
language sql security definer set search_path = public as $$
  delete from devices where auth_uid = auth.uid()
$$;

create or replace function admin_reset_pin(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'nomes_admin'; end if;
  delete from member_secrets where member_id = p_member;
  delete from devices where member_id = p_member;
end $$;

create or replace function admin_set_group_code(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'nomes_admin'; end if;
  update app_config set group_code_hash = crypt(p_code, gen_salt('bf')) where id = 1;
end $$;

-- ───────────────────────── Audit trigger ─────────────────────────
create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
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
end $$;

do $$ declare t text; begin
  foreach t in array array['members','member_kids','att_event_types','att_meetups','att_attendance','att_adjustments'] loop
    execute format('drop trigger if exists audit_%1$s on %1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_trigger()', t);
  end loop;
end $$;

-- ───────────────────────── Tier RPCs ─────────────────────────
create or replace function tier_create(p_placements jsonb, p_categories text[], p_real_index int)
returns uuid
language plpgsql security definer set search_path = public as $$
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
end $$;

-- Returns my status for every game: whether I'm the creator / already guessed, plus the answer when allowed.
create or replace function tier_my_games()
returns table(game_id uuid, is_creator boolean, my_category int, my_creator_guess uuid,
              real_index int, creator_id uuid, guesses int, correct int)
language sql stable security definer set search_path = public as $$
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
$$;

create or replace function tier_guess(p_game uuid, p_category int, p_creator uuid)
returns table(real_index int, creator_id uuid, correct_category boolean, correct_creator boolean)
language plpgsql security definer set search_path = public as $$
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
end $$;

-- Leaderboard: +3 right category, +2 right creator; creator +3 if some-but-not-all guessed the category.
create or replace function tier_leaderboard()
returns table(member_id uuid, points int, games_played int, games_created int)
language sql stable security definer set search_path = public as $$
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
$$;

create or replace function tier_delete(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or exists(select 1 from tier_secrets where game_id = p_game and creator_id = current_member())) then
    raise exception 'no_permis';
  end if;
  delete from tier_games where id = p_game;
end $$;

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

do $$ declare t text; begin
  foreach t in array array['members','member_kids','audit_log','att_event_types','att_meetups','att_attendance','att_adjustments','tier_games'] loop
    execute format('drop policy if exists "%1$s_read" on %1$s', t);
    execute format('create policy "%1$s_read" on %1$s for select using (is_member())', t);
  end loop;
end $$;

-- Admin-only writes
do $$ declare t text; begin
  foreach t in array array['members','member_kids','att_event_types'] loop
    execute format('drop policy if exists "%1$s_admin" on %1$s', t);
    execute format('create policy "%1$s_admin" on %1$s for all using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- Meetups: any member creates; creator or admin edits/deletes
drop policy if exists att_meetups_ins on att_meetups;
create policy att_meetups_ins on att_meetups for insert with check (is_member() and created_by = current_member());
drop policy if exists att_meetups_upd on att_meetups;
create policy att_meetups_upd on att_meetups for update using (is_admin() or created_by = current_member());
drop policy if exists att_meetups_del on att_meetups;
create policy att_meetups_del on att_meetups for delete using (is_admin() or created_by = current_member());

create or replace function can_edit_meetup(p_meetup uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists(select 1 from att_meetups where id = p_meetup and created_by = current_member())
$$;
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
revoke all on app_config, member_secrets, devices, tier_secrets from anon, authenticated;

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
