-- TSI Classroom Live — RLS / RPC spot checks
--
-- Paste the whole file into the Supabase SQL editor (Dashboard → SQL Editor)
-- AFTER the init migration has been applied, and run it.
-- It impersonates the anon and authenticated roles with `set local role` and
-- fake JWT claims, runs the checks, and ROLLS BACK at the end, so nothing is
-- left behind. Each check prints a NOTICE "PASS: …" or raises "FAIL: …".
--
-- It needs one real row in auth.users to own the test room. It picks the first
-- user it finds (sign in once with GitHub first), so run it after your first
-- sign-in.

begin;

do $$
declare
  v_owner   uuid;
  v_room    public.rooms;
  v_join    json;
  v_pid     uuid;
  v_qid     uuid;
  v_count   int;
  v_rows    int;
  v_secret  constant text := repeat('a1', 32);       -- 64 hex chars, like the app's device secret
  v_secret2 constant text := repeat('b2', 32);
begin
  select id into v_owner from auth.users order by created_at limit 1;
  if v_owner is null then
    raise exception 'SETUP: no auth.users row — sign in with GitHub once, then re-run';
  end if;

  -- ── Instructor creates a room ────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_room := public.create_room('RLS check room');
  reset role;
  raise notice 'setup: room % created', v_room.code;

  -- ── Two students join and one asks a question (as anon) ─────────────────
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  v_join := public.join_room(lower(v_room.code), '  Asha  ', v_secret);
  v_pid  := (v_join->>'participant_id')::uuid;
  perform public.join_room(v_room.code, 'Bibek', v_secret2);
  v_qid  := public.ask_question(v_room.id, v_secret, 'useEffect ma dependency array kina chahiyo?');

  -- ── CHECK 1: a second vote from the same student does not raise the count ─
  perform public.vote(v_qid, v_secret2);
  perform public.vote(v_qid, v_secret2);             -- double tap
  select vote_count into v_count from public.questions where id = v_qid;
  if v_count = 1 then
    raise notice 'PASS 1: second vote ignored (vote_count = 1)';
  else
    raise exception 'FAIL 1: vote_count = % after a double vote', v_count;
  end if;

  -- ── CHECK 2: anon cannot update questions (no UPDATE grant at all) ───────
  begin
    update public.questions set status = 'hidden' where id = v_qid;
    get diagnostics v_rows = row_count;
    raise exception 'FAIL 2: anon UPDATE succeeded on % row(s)', v_rows;
  exception when insufficient_privilege then
    raise notice 'PASS 2: anon UPDATE on questions → permission denied';
  end;

  -- ── CHECK 3: a wrong device secret gets the generic 'not allowed' ────────
  begin
    perform public.vote(v_qid, repeat('ff', 32));
    raise exception 'FAIL 3: vote with a wrong secret succeeded';
  exception when raise_exception then
    if sqlerrm = 'not allowed' then
      raise notice 'PASS 3: wrong secret → not allowed';
    else
      raise exception 'FAIL 3: unexpected error: %', sqlerrm;
    end if;
  end;

  -- ── Bonus: anon cannot read votes or participants directly ───────────────
  begin
    perform 1 from public.votes limit 1;
    raise exception 'FAIL 4: anon can SELECT votes';
  exception when insufficient_privilege then
    raise notice 'PASS 4: anon SELECT on votes → permission denied';
  end;

  begin
    perform 1 from public.participants limit 1;
    raise exception 'FAIL 5: anon can SELECT participants';
  exception when insufficient_privilege then
    raise notice 'PASS 5: anon SELECT on participants → permission denied';
  end;

  reset role;
end $$;

rollback;   -- nothing is kept
