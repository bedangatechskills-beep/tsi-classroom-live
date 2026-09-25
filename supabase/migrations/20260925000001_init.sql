-- TSI Classroom Live — initial schema
-- Seven tables, RLS on all of them. Students (anon key + device secret) write
-- only through security definer RPCs; the instructor (GitHub OAuth user) owns
-- rooms and moderates through column-limited UPDATEs guarded by RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       char(6) unique not null,              -- A–Z minus I, O
  title      text not null,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status     text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);

create table public.participants (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 24),
  secret_hash text not null,                        -- hex sha256 of the device secret
  created_at  timestamptz not null default now(),
  unique (room_id, secret_hash)
);

create table public.questions (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  body           text not null check (char_length(body) between 1 and 500),
  status         text not null default 'open' check (status in ('open', 'answered', 'hidden')),
  vote_count     int not null default 0,            -- kept by trigger
  created_at     timestamptz not null default now(),
  answered_at    timestamptz
);

create table public.votes (
  question_id    uuid not null references public.questions (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (question_id, participant_id)         -- one vote per student per question
);

create table public.polls (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  prompt     text not null,
  status     text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);

create table public.poll_options (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.polls (id) on delete cascade,
  label      text not null,
  position   int not null,
  vote_count int not null default 0                 -- kept by trigger
);

create table public.poll_votes (
  poll_id        uuid not null references public.polls (id) on delete cascade,
  option_id      uuid not null references public.poll_options (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (poll_id, participant_id)             -- one answer per student per poll
);

create index participants_room_id_idx      on public.participants (room_id);
create index questions_room_id_idx         on public.questions (room_id);
create index questions_participant_id_idx  on public.questions (participant_id, created_at);
create index votes_participant_id_idx      on public.votes (participant_id);
create index polls_room_id_idx             on public.polls (room_id);
create index poll_options_poll_id_idx      on public.poll_options (poll_id);
create index poll_votes_option_id_idx      on public.poll_votes (option_id);
create index poll_votes_participant_id_idx on public.poll_votes (participant_id);
create index rooms_owner_id_idx            on public.rooms (owner_id);

alter table public.rooms        enable row level security;
alter table public.participants enable row level security;
alter table public.questions    enable row level security;
alter table public.votes        enable row level security;
alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — start from nothing, grant back only the approved matrix.
-- (Supabase's default privileges give anon/authenticated ALL on new tables.)
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on table
  public.rooms, public.participants, public.questions, public.votes,
  public.polls, public.poll_options, public.poll_votes
from anon, authenticated;

-- rooms: everyone can look up by code; owner may close
grant select on public.rooms to anon, authenticated;
grant update (status, closed_at) on public.rooms to authenticated;

-- participants: instructor sees nicknames in own rooms; never the secret hash
grant select (id, room_id, nickname, created_at) on public.participants to authenticated;

-- questions: anon never sees participant_id; owner may set status/answered_at only
grant select (id, room_id, body, status, vote_count, created_at, answered_at) on public.questions to anon;
grant select on public.questions to authenticated;
grant update (status, answered_at) on public.questions to authenticated;

-- polls + options: readable by all; owner may close a poll
grant select on public.polls, public.poll_options to anon, authenticated;
grant update (status, closed_at) on public.polls to authenticated;

-- votes, poll_votes: no grants (my_state() reports a student's own votes)

-- ─────────────────────────────────────────────────────────────────────────────
-- Policies
-- ─────────────────────────────────────────────────────────────────────────────

create policy rooms_select_all on public.rooms
  for select to anon, authenticated
  using (true);

create policy rooms_update_owner on public.rooms
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy participants_select_owner on public.participants
  for select to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()));

create policy questions_select_anon on public.questions
  for select to anon
  using (status <> 'hidden');

create policy questions_select_authenticated on public.questions
  for select to authenticated
  using (
    status <> 'hidden'
    or exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid())
  );

create policy questions_update_owner on public.questions
  for update to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()));

create policy polls_select_all on public.polls
  for select to anon, authenticated
  using (true);

create policy polls_update_owner on public.polls
  for update to authenticated
  using (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from public.rooms r where r.id = room_id and r.owner_id = auth.uid()));

create policy poll_options_select_all on public.poll_options
  for select to anon, authenticated
  using (true);

-- votes, poll_votes: RLS on, no policies → no direct access for anon/authenticated.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────────────────────

create function public.hash_secret(p_secret text) returns text
language sql immutable strict set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Instructor functions (authenticated only)
-- ─────────────────────────────────────────────────────────────────────────────

create function public.create_room(p_title text) returns public.rooms
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid      uuid := auth.uid();
  v_title    text := btrim(coalesce(p_title, ''));
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';   -- 24 letters, no I, O
  v_code     text;
  v_room     public.rooms;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'title must be 1–120 characters';
  end if;

  for attempt in 1..10 loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * 24)::int, 1);
    end loop;
    begin
      insert into public.rooms (code, title, owner_id)
      values (v_code, v_title, v_uid)
      returning * into v_room;
      return v_room;
    exception when unique_violation then
      -- code collision: try another
    end;
  end loop;

  raise exception 'could not generate a unique room code';
end $$;

create function public.create_poll(p_room_id uuid, p_prompt text, p_options text[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prompt  text := btrim(coalesce(p_prompt, ''));
  v_poll_id uuid;
  v_label   text;
  v_pos     int := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.owner_id = auth.uid() and r.status = 'open'
  ) then
    raise exception 'not allowed';
  end if;
  if char_length(v_prompt) not between 1 and 200 then
    raise exception 'prompt must be 1–200 characters';
  end if;
  if coalesce(array_length(p_options, 1), 0) not between 2 and 4 then
    raise exception 'a poll needs 2–4 options';
  end if;

  insert into public.polls (room_id, prompt) values (p_room_id, v_prompt)
  returning id into v_poll_id;

  foreach v_label in array p_options loop
    v_label := btrim(coalesce(v_label, ''));
    if char_length(v_label) not between 1 and 80 then
      raise exception 'each option must be 1–80 characters';
    end if;
    v_pos := v_pos + 1;
    insert into public.poll_options (poll_id, label, position) values (v_poll_id, v_label, v_pos);
  end loop;

  return v_poll_id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Student functions (anon + authenticated). Every one checks the device secret.
-- ─────────────────────────────────────────────────────────────────────────────

create function public.join_room(p_code text, p_nickname text, p_secret text) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room     public.rooms;
  v_nickname text := btrim(coalesce(p_nickname, ''));
  v_pid      uuid;
begin
  if p_secret is null or char_length(p_secret) not between 32 and 256 then
    raise exception 'not allowed';
  end if;

  select * into v_room from public.rooms
  where code = upper(btrim(coalesce(p_code, ''))) and status = 'open';
  if v_room.id is null then
    raise exception 'room not found or closed';
  end if;

  if char_length(v_nickname) not between 1 and 24 then
    raise exception 'nickname must be 1–24 characters';
  end if;

  insert into public.participants (room_id, nickname, secret_hash)
  values (v_room.id, v_nickname, public.hash_secret(p_secret))
  on conflict (room_id, secret_hash) do update set nickname = excluded.nickname
  returning id into v_pid;

  return json_build_object(
    'participant_id', v_pid,
    'room_id',        v_room.id,
    'title',          v_room.title,
    'status',         v_room.status
  );
end $$;

create function public.ask_question(p_room_id uuid, p_secret text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_pid  uuid;
  v_qid  uuid;
begin
  -- lock the participant row so two fast taps can't both pass the rate limit
  select p.id into v_pid
  from public.participants p
  join public.rooms r on r.id = p.room_id
  where p.room_id = p_room_id
    and r.status = 'open'
    and p.secret_hash = public.hash_secret(p_secret)
  for update of p;
  if v_pid is null then
    raise exception 'not allowed';
  end if;

  if char_length(v_body) not between 1 and 500 then
    raise exception 'question must be 1–500 characters';
  end if;

  if exists (
    select 1 from public.questions q
    where q.participant_id = v_pid and q.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'slow down';
  end if;

  insert into public.questions (room_id, participant_id, body)
  values (p_room_id, v_pid, v_body)
  returning id into v_qid;

  return v_qid;
end $$;

create function public.vote(p_question_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pid uuid;
begin
  select p.id into v_pid
  from public.questions q
  join public.rooms r        on r.id = q.room_id
  join public.participants p on p.room_id = q.room_id
  where q.id = p_question_id
    and q.status = 'open'
    and r.status = 'open'
    and p.secret_hash = public.hash_secret(p_secret);
  if v_pid is null then
    raise exception 'not allowed';
  end if;

  insert into public.votes (question_id, participant_id) values (p_question_id, v_pid)
  on conflict do nothing;                           -- trigger bumps questions.vote_count
end $$;

create function public.poll_vote(p_option_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_poll_id uuid;
  v_pid     uuid;
begin
  select pl.id, p.id into v_poll_id, v_pid
  from public.poll_options o
  join public.polls pl       on pl.id = o.poll_id
  join public.rooms r        on r.id = pl.room_id
  join public.participants p on p.room_id = pl.room_id
  where o.id = p_option_id
    and pl.status = 'open'
    and r.status = 'open'
    and p.secret_hash = public.hash_secret(p_secret);
  if v_pid is null then
    raise exception 'not allowed';
  end if;

  insert into public.poll_votes (poll_id, option_id, participant_id)
  values (v_poll_id, p_option_id, v_pid)
  on conflict do nothing;                           -- trigger bumps poll_options.vote_count
end $$;

create function public.my_state(p_room_id uuid, p_secret text) returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_pid uuid;
begin
  select p.id into v_pid from public.participants p
  where p.room_id = p_room_id and p.secret_hash = public.hash_secret(p_secret);
  if v_pid is null then
    raise exception 'not allowed';
  end if;

  return json_build_object(
    'question_ids_voted',
      coalesce((select json_agg(v.question_id) from public.votes v where v.participant_id = v_pid), '[]'::json),
    'poll_ids_voted',
      coalesce((select json_agg(pv.poll_id) from public.poll_votes pv where pv.participant_id = v_pid), '[]'::json)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vote counters (trigger-kept on the parent row so Realtime needs one table)
-- ─────────────────────────────────────────────────────────────────────────────

create function public.bump_question_vote_count() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.questions set vote_count = vote_count + 1 where id = new.question_id;
  return null;
end $$;

create trigger votes_bump_count
  after insert on public.votes
  for each row execute function public.bump_question_vote_count();

create function public.bump_poll_option_vote_count() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.poll_options set vote_count = vote_count + 1 where id = new.option_id;
  return null;
end $$;

create trigger poll_votes_bump_count
  after insert on public.poll_votes
  for each row execute function public.bump_poll_option_vote_count();

-- ─────────────────────────────────────────────────────────────────────────────
-- Function privileges. Postgres grants EXECUTE to PUBLIC by default and
-- Supabase's default privileges add anon/authenticated, so revoke from all first.
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function
  public.hash_secret(text),
  public.create_room(text),
  public.create_poll(uuid, text, text[]),
  public.join_room(text, text, text),
  public.ask_question(uuid, text, text),
  public.vote(uuid, text),
  public.poll_vote(uuid, text),
  public.my_state(uuid, text),
  public.bump_question_vote_count(),
  public.bump_poll_option_vote_count()
from public, anon, authenticated;

grant execute on function
  public.create_room(text),
  public.create_poll(uuid, text, text[])
to authenticated;

grant execute on function
  public.join_room(text, text, text),
  public.ask_question(uuid, text, text),
  public.vote(uuid, text),
  public.poll_vote(uuid, text),
  public.my_state(uuid, text)
to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime — forgetting this is the #1 "realtime is silent" cause.
-- Default replica identity is enough: every filter is on room_id / poll_id,
-- which never change, and the new row image is always complete for UPDATEs.
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.rooms, public.questions, public.polls, public.poll_options;
