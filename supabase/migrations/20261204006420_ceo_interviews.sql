-- =============================================================================
-- NEXA · 6420 · CEO interviews in NEXA Nachrichten (ADR-173)
-- =============================================================================
-- Now and then the show asks a founder for an interview:
-- * company_interviews_run_due() (hourly): requests expire after expiresHours ("kein Kommentar" by silence); every
--   active company whose founder was around lately rolls a 24th of its daily chance (more for bigger and listed
--   companies and after a scandal, layoffs or a loss), at most one roll an hour and one request per cooldownHours.
-- * company_interview_request(): three questions from game_config.interviews.pool that fit the company's facts
--   (profit, loss, listed, mood, layoffs, scandal, size, staff, awareness), at most maxSituational of them tied to
--   the situation; a notification to the founder.
-- * get_company_interview(), answer_company_interview(), decline_company_interview(): the founder answers each
--   question in free text (length-limited, moderated with text_has_profanity) or with one of three quick answers.
--   The Mini-KI (company_interview_judge, same rules as src/lib/sim/interviews.ts) judges every answer -2..+2;
--   the sum moves awareness (and the reputation of a listed company), capped. Declining or ignoring costs a little.
--   The effects apply at once, so the interview never depends on the show airing.
-- * news_show_interviews() gives the next show one interview: per question a segment "interview" (the host asks,
--   reads the answer and reacts, with a mood per verdict; the CEO's figure on the screen), or one "kein Kommentar"
--   segment. news_show_start() marks it aired once (apply type "interview") and files it under companies in the feed.
-- Errors: interview_not_found NX260, interview_text_invalid NX261, interview_closed NX262.
-- Idempotent: runs unchanged as supabase/updates/20261204006420_ceo_interviews.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys and the notification type
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_new text := $q$    when 'interview_not_found'        then 'NX260'
    when 'interview_text_invalid'     then 'NX261'
    when 'interview_closed'           then 'NX262'
    else 'NX007'$q$;
begin
  if position('''interview_closed''' in v_def) = 0 then
    if position($q$    else 'NX007'$q$ in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the interview error keys (ADR-173) by hand';
    end if;
    execute replace(v_def, $q$    else 'NX007'$q$, v_new);
  end if;
end;
$do$;

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('company_interview', 'company', 'Interviewanfrage', 'NEXA Nachrichten möchte dich als Chef deiner Firma interviewen.',
        'notif_company', true, true, false, 210)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Tables (internal: read and written only by the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.company_interviews (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.companies (id) on delete cascade,
  ceo_id           uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'requested' check (status in ('requested', 'answered', 'declined', 'expired')),
  -- [{key, when, text, quick: [{text, tone}], good: [...]}], texts already filled in
  questions        jsonb not null,
  -- [{text, quick, verdict, points, reaction}] once answered
  answers          jsonb,
  score            integer,
  awareness_bps    integer not null default 0,
  reputation_delta double precision not null default 0,
  judge            text not null default 'mini' check (judge in ('mini', 'claude')),
  requested_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  answered_at      timestamptz,
  aired_at         timestamptz,
  show_id          bigint
);
create unique index if not exists company_interviews_open_uq on public.company_interviews (company_id) where status = 'requested';
create index if not exists company_interviews_company_idx on public.company_interviews (company_id, requested_at desc);
create index if not exists company_interviews_ceo_idx on public.company_interviews (ceo_id, requested_at desc);
create index if not exists company_interviews_unaired_idx on public.company_interviews (answered_at) where aired_at is null;
alter table public.company_interviews enable row level security;
comment on table public.company_interviews is
  'CEO interviews of NEXA Nachrichten (ADR-173). No client access: get_company_interview() and the answer RPCs.';

-- when every company last rolled for a request (one roll an hour)
create table if not exists public.company_interview_rolls (
  company_id uuid primary key references public.companies (id) on delete cascade,
  rolled_at  timestamptz not null
);
alter table public.company_interview_rolls enable row level security;
comment on table public.company_interview_rolls is 'Internal: last hourly roll for a CEO interview per company (ADR-173).';

-- ---------------------------------------------------------------------------
-- C. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.interviews_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'interviews'), '{}'::jsonb);
$$;

-- What the show knows about a company when it asks (InterviewFacts in src/lib/sim/interviews.ts)
create or replace function public.company_interview_facts(p_company uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tier', pc.tier,
    'listed', public.listed_is(pc.company_id),
    'profit_cents', (select r.operating_profit_cents from public.player_company_reports r
                      where r.company_id = pc.company_id order by r.game_quarter_id desc limit 1),
    'satisfaction', (select round(l.satisfaction)::integer from public.listed_companies l
                      where l.company_id = pc.company_id and public.listed_is(pc.company_id)),
    'layoffs', (select count(*) from public.player_jobs j
                 where j.company_id = pc.company_id and j.status::text = 'ended' and j.end_reason::text = 'fired'
                   and j.ended_at >= p_now - make_interval(hours => coalesce((public.interviews_cfg() ->> 'layoffHours')::integer, 72))),
    'scandal', exists (select 1 from public.news_shows s
                        where s.status = 'aired'
                          and s.started_at >= p_now - make_interval(hours => coalesce((public.interviews_cfg() ->> 'scandalHours')::integer, 24))
                          and exists (select 1 from jsonb_array_elements(s.segments) x
                                       where x ->> 'kind' = 'scandal' and x -> 'subject' ->> 'company_id' = pc.company_id::text)),
    'staff', (select count(*) from public.player_jobs j where j.company_id = pc.company_id and j.status::text = 'active'),
    'awareness_bps', round(coalesce(pc.awareness, 0) * 10000)::integer,
    'name', c.name,
    'ceo', p.nickname,
    'ceo_id', pc.founder_id)
    from public.player_companies pc
    join public.companies c on c.id = pc.company_id
    join public.profiles p on p.id = pc.founder_id
   where pc.company_id = p_company and pc.status = 'active';
$$;

-- Does a question's "when" hold for these facts (whenHolds)
create or replace function public.company_interview_when(p_when text, f jsonb, cfg jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_when
    when 'always'  then true
    when 'profit'  then (f ->> 'profit_cents')::bigint > 0
    when 'loss'    then (f ->> 'profit_cents')::bigint < 0
    when 'listed'  then (f ->> 'listed')::boolean
    when 'unhappy' then (f ->> 'satisfaction')::numeric < (cfg ->> 'unhappyBelow')::numeric
    when 'happy'   then (f ->> 'satisfaction')::numeric >= (cfg ->> 'happyFrom')::numeric
    when 'layoffs' then (f ->> 'layoffs')::integer > 0
    when 'scandal' then (f ->> 'scandal')::boolean
    when 'big'     then f ->> 'tier' in ('gmbh', 'ag')
    when 'small'   then f ->> 'tier' in ('garage', 'small_business')
    when 'solo'    then (f ->> 'staff')::integer = 0
    when 'famous'  then (f ->> 'awareness_bps')::integer >= (cfg ->> 'awarenessFamousBps')::integer
    when 'unknown' then (f ->> 'awareness_bps')::integer < (cfg ->> 'awarenessUnknownBps')::integer
    else false end, false);
$$;

-- Chance of a request per day in bps (interviewChancePerDayBps)
create or replace function public.company_interview_chance_bps(f jsonb, cfg jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(coalesce((cfg ->> 'maxChancePerDayBps')::integer, 9000),
               coalesce((cfg ->> 'chancePerDayBps')::integer, 0)
               + coalesce((cfg #>> array['tierBonusBps', f ->> 'tier'])::integer, 0)
               + case when coalesce((f ->> 'listed')::boolean, false) then coalesce((cfg ->> 'listedBonusBps')::integer, 0) else 0 end
               + case when coalesce((f ->> 'scandal')::boolean, false) or coalesce((f ->> 'layoffs')::integer, 0) > 0
                           or coalesce((f ->> 'profit_cents')::bigint < 0, false)
                      then coalesce((cfg ->> 'eventBonusBps')::integer, 0) else 0 end);
$$;

-- {name} placeholders filled in; unknown ones stay
create or replace function public.company_interview_fill(p_text text, p_values jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := coalesce(p_text, '');
  k     text;
  v     text;
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_values, '{}'::jsonb)) loop
    v_out := replace(v_out, '{' || k || '}', coalesce(v, ''));
  end loop;
  return v_out;
end;
$$;

-- A random line of a jsonb array of texts
create or replace function public.company_interview_line(p_lines jsonb)
returns text
language sql
volatile
set search_path = ''
as $$
  select x from jsonb_array_elements_text(coalesce(p_lines, '[]'::jsonb)) x order by random() limit 1;
$$;

-- The Mini-KI's judgement of one answer, points -2..+2 (judgeInterviewAnswer); {verdict, points, text}
create or replace function public.company_interview_judge(p_question jsonb, p_answer jsonb, cfg jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  j       jsonb := coalesce(cfg -> 'judge', '{}'::jsonb);
  v_quick numeric;
  v_tone  text;
  v_text  text;
  v_lower text;
  v_good  integer;
  v_bad   integer;
  v_pts   integer;
begin
  if jsonb_typeof(p_answer -> 'quick') = 'number' then
    v_quick := (p_answer ->> 'quick')::numeric;
    if v_quick % 1 = 0 and v_quick >= 0 and v_quick < jsonb_array_length(coalesce(p_question -> 'quick', '[]'::jsonb)) then
      v_tone := p_question -> 'quick' -> v_quick::integer ->> 'tone';
      return jsonb_build_object('verdict', v_tone, 'points', coalesce((j #>> array['quickPoints', v_tone])::integer, 0),
                                'text', p_question -> 'quick' -> v_quick::integer ->> 'text', 'quick', v_quick::integer);
    end if;
  end if;
  v_text := regexp_replace(regexp_replace(coalesce(case when jsonb_typeof(p_answer -> 'text') = 'string' then p_answer ->> 'text' end, ''),
                                          '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g');
  if char_length(v_text) < coalesce((cfg ->> 'minChars')::integer, 2) then
    return jsonb_build_object('verdict', 'none', 'points', coalesce((j ->> 'nonePoints')::integer, -1), 'text', '');
  end if;
  v_lower := lower(v_text);
  select count(*) into v_good
    from (select distinct w from (select jsonb_array_elements_text(coalesce(j -> 'good', '[]'::jsonb)) w
                                  union all
                                  select jsonb_array_elements_text(coalesce(p_question -> 'good', '[]'::jsonb))) a) d
   where position(d.w in v_lower) > 0;
  select count(*) into v_bad
    from jsonb_array_elements_text(coalesce(j -> 'bad', '[]'::jsonb)) w where position(w in v_lower) > 0;
  v_pts := least(v_good, coalesce((j ->> 'maxGood')::integer, 2)) - least(v_bad, coalesce((j ->> 'maxBad')::integer, 2))
           + case when char_length(v_text) >= coalesce((j ->> 'longChars')::integer, 60) then 1 else 0 end
           - case when char_length(v_text) < coalesce((j ->> 'shortChars')::integer, 8) then 1 else 0 end;
  v_pts := greatest(-2, least(2, v_pts));
  return jsonb_build_object('verdict', case when v_pts >= 1 then 'good' when v_pts <= -1 then 'bad' else 'ok' end,
                            'points', v_pts, 'text', v_text);
end;
$$;

-- Finishes an interview and applies its capped effects at once (interviewEffects)
create or replace function public.company_interview_finish(p_id bigint, p_status text, p_answers jsonb, p_points integer,
                                                           p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.interviews_cfg();
  e        jsonb := coalesce(public.interviews_cfg() -> 'effects', '{}'::jsonb);
  iv       public.company_interviews;
  v_listed boolean;
  v_aw     integer;
  v_rep    double precision;
  v_max    integer := coalesce((e ->> 'maxAwarenessBps')::integer, 300);
  v_maxr   double precision := coalesce((e ->> 'maxReputation')::double precision, 3);
begin
  select * into iv from public.company_interviews where id = p_id for update;
  if iv.id is null or iv.status <> 'requested' then
    return;
  end if;
  v_listed := public.listed_is(iv.company_id);
  v_aw := case p_status
            when 'answered' then greatest(-v_max, least(v_max, coalesce(p_points, 0) * coalesce((e ->> 'awarenessPerPointBps')::integer, 60)))
            when 'declined' then coalesce((e ->> 'declineAwarenessBps')::integer, -80)
            else coalesce((e ->> 'ignoreAwarenessBps')::integer, -120) end;
  v_rep := case when not v_listed then 0
                when p_status = 'answered' then greatest(-v_maxr, least(v_maxr, coalesce(p_points, 0) * coalesce((e ->> 'reputationPerPoint')::double precision, 0.5)))
                when p_status = 'declined' then coalesce((e ->> 'declineReputation')::double precision, -0.5)
                else coalesce((e ->> 'ignoreReputation')::double precision, -1) end;
  update public.player_companies pc
     set awareness = least(1, greatest(0, coalesce(pc.awareness, 0) + v_aw / 10000.0))
   where pc.company_id = iv.company_id and pc.status = 'active';
  if v_listed and v_rep <> 0 then
    perform public.listed_ensure(iv.company_id);
    update public.listed_companies l set reputation = least(100, greatest(0, l.reputation + v_rep)) where l.company_id = iv.company_id;
  end if;
  update public.company_interviews
     set status = p_status, answers = p_answers, score = p_points, awareness_bps = v_aw, reputation_delta = v_rep,
         answered_at = p_now
   where id = p_id;
end;
$$;

-- A new request for the company, if it has none open; null otherwise. Writes the questions and notifies the founder.
create or replace function public.company_interview_request(p_company uuid, p_now timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg    jsonb := public.interviews_cfg();
  v_now  timestamptz := coalesce(p_now, public.game_now());
  f      jsonb;
  v_vals jsonb;
  v_qs   jsonb;
  v_id   bigint;
begin
  f := public.company_interview_facts(p_company, v_now);
  if f is null or exists (select 1 from public.company_interviews i where i.company_id = p_company and i.status = 'requested') then
    return null;
  end if;
  v_vals := jsonb_build_object(
    'ceo', f ->> 'ceo', 'company', f ->> 'name',
    'profit', case when f ->> 'profit_cents' is null then '' else public.format_eur(abs((f ->> 'profit_cents')::bigint)) end,
    'satisfaction', coalesce(f ->> 'satisfaction', ''), 'staff', f ->> 'staff');
  select jsonb_agg(jsonb_build_object(
           'key', y.q ->> 'key', 'when', y.q ->> 'when',
           'text', public.company_interview_fill(y.q ->> 'text', v_vals),
           'quick', coalesce((select jsonb_agg(jsonb_build_object('text', public.company_interview_fill(a ->> 'text', v_vals),
                                                                  'tone', a ->> 'tone') order by o)
                                from jsonb_array_elements(y.q -> 'quick') with ordinality z(a, o)), '[]'::jsonb),
           'good', coalesce(y.q -> 'good', '[]'::jsonb)) order by y.sit desc, y.r)
    into v_qs
    from (select x.q, x.sit, x.r
            from (select q, (q ->> 'when') <> 'always' as sit, random() as r,
                         row_number() over (partition by (q ->> 'when') <> 'always' order by random()) as prn
                    from jsonb_array_elements(coalesce(cfg -> 'pool', '[]'::jsonb)) q
                   where public.company_interview_when(q ->> 'when', f, cfg)) x
           where not x.sit or x.prn <= coalesce((cfg ->> 'maxSituational')::integer, 2)
           order by x.sit desc, x.r
           limit coalesce((cfg ->> 'count')::integer, 3)) y;
  if coalesce(jsonb_array_length(v_qs), 0) = 0 then
    return null;
  end if;
  insert into public.company_interviews (company_id, ceo_id, questions, requested_at, expires_at)
  values (p_company, (f ->> 'ceo_id')::uuid, v_qs, v_now,
          v_now + make_interval(hours => coalesce((cfg ->> 'expiresHours')::integer, 6)))
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.social_notify((f ->> 'ceo_id')::uuid, 'company_interview',
      public.company_interview_fill(cfg #>> '{texts,notifyTitle}', v_vals),
      public.company_interview_fill(cfg #>> '{texts,notifyBody}', v_vals || jsonb_build_object('hours', coalesce(cfg ->> 'expiresHours', '6'))),
      jsonb_build_object('interview_id', v_id), '/company', 'interview:' || v_id::text);
  end if;
  return v_id;
end;
$$;

-- The hourly job: expire what was ignored, then roll for new requests
create or replace function public.company_interviews_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.interviews_cfg();
  v_now     timestamptz := coalesce(p_now, public.game_now());
  r         record;
  v_expired integer := 0;
  v_asked   integer := 0;
begin
  if cfg = '{}'::jsonb then
    return jsonb_build_object('expired', 0, 'requested', 0);
  end if;
  for r in select i.id from public.company_interviews i where i.status = 'requested' and i.expires_at <= v_now
            order by i.id for update skip locked loop
    perform public.company_interview_finish(r.id, 'expired', null, null, v_now);
    v_expired := v_expired + 1;
  end loop;
  for r in select pc.company_id
             from public.player_companies pc
             join public.profiles p on p.id = pc.founder_id and not p.is_deactivated
            where pc.status = 'active'
              and p.last_active_at >= v_now - make_interval(hours => coalesce((cfg ->> 'activeHours')::integer, 48))
              and not exists (select 1 from public.company_interviews i
                               where i.company_id = pc.company_id
                                 and (i.status = 'requested'
                                      or i.requested_at > v_now - make_interval(hours => coalesce((cfg ->> 'cooldownHours')::integer, 20))))
              and not exists (select 1 from public.company_interview_rolls x
                               where x.company_id = pc.company_id and x.rolled_at > v_now - interval '55 minutes') loop
    insert into public.company_interview_rolls (company_id, rolled_at) values (r.company_id, v_now)
    on conflict (company_id) do update set rolled_at = excluded.rolled_at;
    if random() * 10000 * 24 < public.company_interview_chance_bps(public.company_interview_facts(r.company_id, v_now), cfg) then
      if public.company_interview_request(r.company_id, v_now) is not null then
        v_asked := v_asked + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('expired', v_expired, 'requested', v_asked);
end;
$$;

-- The caller's interview for the client: the open request, else the latest of the last day
create or replace function public.company_interview_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'max_chars', coalesce((public.interviews_cfg() ->> 'maxChars')::integer, 240),
    'interview', (
      select jsonb_build_object(
               'id', i.id, 'status', i.status, 'company', c.name, 'requested_at', i.requested_at, 'expires_at', i.expires_at,
               'answered_at', i.answered_at, 'aired_at', i.aired_at,
               'questions', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'text', q ->> 'text',
                                 'quick', (select coalesce(jsonb_agg(a ->> 'text' order by o), '[]'::jsonb)
                                             from jsonb_array_elements(q -> 'quick') with ordinality z(a, o))) order by n), '[]'::jsonb)
                               from jsonb_array_elements(i.questions) with ordinality t(q, n)),
               'answers', case when i.answers is null then null else
                            (select coalesce(jsonb_agg(jsonb_build_object('text', a ->> 'text', 'verdict', a ->> 'verdict',
                                                                          'reaction', a ->> 'reaction') order by n), '[]'::jsonb)
                               from jsonb_array_elements(i.answers) with ordinality t(a, n)) end,
               'awareness_bps', i.awareness_bps, 'reputation', i.reputation_delta)
        from public.company_interviews i
        join public.companies c on c.id = i.company_id
       where i.ceo_id = p_player
         and (i.status = 'requested' or i.requested_at > public.game_now() - interval '24 hours')
       order by (i.status = 'requested') desc, i.requested_at desc
       limit 1));
$$;

-- ---------------------------------------------------------------------------
-- D. RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_company_interview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  return public.company_interview_json(v_player);
end;
$$;

create or replace function public.answer_company_interview(p_request_id uuid, p_interview_id bigint, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.interviews_cfg();
  v_player uuid;
  v_replay jsonb;
  iv       public.company_interviews;
  a        jsonb;
  v_text   text;
  v_judged jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_points integer := 0;
  v_vals   jsonb;
  k        integer;
begin
  v_player := public.require_player();
  if p_request_id is null or p_interview_id is null or jsonb_typeof(p_answers) is distinct from 'array' then
    perform public.api_error('invalid_argument');
  end if;
  -- moderation before anything is stored: length, control characters, the word filter
  for a in select x from jsonb_array_elements(p_answers) x loop
    if jsonb_typeof(a) <> 'object' or (a ? 'text' and jsonb_typeof(a -> 'text') not in ('string', 'null'))
       or (a ? 'quick' and jsonb_typeof(a -> 'quick') not in ('number', 'null')) then
      perform public.api_error('invalid_argument');
    end if;
    v_text := coalesce(a ->> 'text', '');
    if char_length(v_text) > coalesce((cfg ->> 'maxChars')::integer, 240) or v_text ~ '[\x00-\x08\x0b-\x1f]'
       or public.text_has_profanity(v_text) then
      perform public.api_error('interview_text_invalid');
    end if;
  end loop;
  v_replay := public.request_begin(v_player, p_request_id, 'answer_company_interview');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into iv from public.company_interviews where id = p_interview_id and ceo_id = v_player for update;
  if iv.id is null then
    perform public.api_error('interview_not_found');
  end if;
  if iv.status <> 'requested' or iv.expires_at <= public.game_now() then
    perform public.api_error('interview_closed');
  end if;
  if jsonb_array_length(p_answers) <> jsonb_array_length(iv.questions) then
    perform public.api_error('invalid_argument');
  end if;
  select jsonb_build_object('ceo', p.nickname, 'company', c.name) into v_vals
    from public.profiles p, public.companies c where p.id = v_player and c.id = iv.company_id;
  for k in 0..jsonb_array_length(iv.questions) - 1 loop
    v_judged := public.company_interview_judge(iv.questions -> k, p_answers -> k, cfg);
    v_points := v_points + (v_judged ->> 'points')::integer;
    v_out := v_out || (v_judged || jsonb_build_object(
      'reaction', public.company_interview_fill(public.company_interview_line(cfg #> array['texts', 'reactions', v_judged ->> 'verdict']), v_vals)));
  end loop;
  perform public.company_interview_finish(iv.id, 'answered', v_out, v_points, public.game_now());
  return public.request_complete(v_player, p_request_id, public.company_interview_json(v_player));
end;
$$;

create or replace function public.decline_company_interview(p_request_id uuid, p_interview_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  iv       public.company_interviews;
begin
  v_player := public.require_player();
  if p_request_id is null or p_interview_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'decline_company_interview');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into iv from public.company_interviews where id = p_interview_id and ceo_id = v_player for update;
  if iv.id is null then
    perform public.api_error('interview_not_found');
  end if;
  if iv.status <> 'requested' or iv.expires_at <= public.game_now() then
    perform public.api_error('interview_closed');
  end if;
  perform public.company_interview_finish(iv.id, 'declined', null, null, public.game_now());
  return public.request_complete(v_player, p_request_id, public.company_interview_json(v_player));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. The show: segments of the next interview
-- ---------------------------------------------------------------------------
create or replace function public.news_show_interviews(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.interviews_cfg();
  tx      jsonb := coalesce(public.interviews_cfg() -> 'texts', '{}'::jsonb);
  iv      record;
  v_out   jsonb := '[]'::jsonb;
  v_vals  jsonb;
  v_n     integer;
  v_k     integer;
  v_eff   jsonb;
  v_subj  jsonb;
  v_ord   integer := coalesce((cfg ->> 'ord')::integer, 15);
  v_ans   jsonb;
begin
  if cfg = '{}'::jsonb then
    return v_out;
  end if;
  for iv in select i.*, c.name as company, p.nickname as ceo
              from public.company_interviews i
              join public.companies c on c.id = i.company_id
              join public.profiles p on p.id = i.ceo_id and not p.is_deactivated
             where i.status in ('answered', 'declined', 'expired') and i.aired_at is null
               and i.answered_at >= p_now - make_interval(hours => coalesce((cfg ->> 'airWithinHours')::integer, 30))
             order by i.answered_at, i.id
             limit coalesce((cfg ->> 'perShow')::integer, 1) loop
    v_vals := jsonb_build_object('ceo', iv.ceo, 'company', iv.company);
    v_eff := jsonb_build_array(jsonb_build_object(
      'label', coalesce(tx ->> 'effectAwareness', 'Bekanntheit') || ' '
               || case when iv.awareness_bps > 0 then '+' when iv.awareness_bps < 0 then '−' else '±' end
               || public.news_show_move(iv.awareness_bps),
      'tone', case when iv.awareness_bps > 0 then 'gain' when iv.awareness_bps < 0 then 'loss' else 'neutral' end));
    if iv.reputation_delta <> 0 then
      v_eff := v_eff || jsonb_build_object(
        'label', coalesce(tx ->> 'effectReputation', 'Ruf') || ' ' || case when iv.reputation_delta > 0 then '+' else '−' end
                 || replace(to_char(abs(iv.reputation_delta), 'FM990.0'), '.', ','),
        'tone', case when iv.reputation_delta > 0 then 'gain' else 'loss' end);
    end if;
    v_subj := jsonb_build_object('type', 'interview', 'player_id', iv.ceo_id, 'company_id', iv.company_id, 'name', iv.ceo,
                                 'company', iv.company, 'interview_id', iv.id, 'ukey', 'fact:interview:' || iv.id::text,
                                 'values', v_vals);
    if iv.status = 'answered' and jsonb_typeof(iv.answers) = 'array' then
      v_n := jsonb_array_length(iv.questions);
      for v_k in 0..v_n - 1 loop
        v_ans := iv.answers -> v_k;
        v_out := v_out || jsonb_build_object(
          'kind', 'interview',
          'mood', coalesce(public.company_interview_line(cfg #> array['moods', coalesce(v_ans ->> 'verdict', 'ok')]), 'neutral'),
          'headline', public.company_interview_fill(tx ->> 'headline', v_vals || jsonb_build_object('n', v_k + 1, 'total', v_n)),
          'text', public.company_interview_fill(tx ->> 'text', v_vals || jsonb_build_object(
                    'question', iv.questions -> v_k ->> 'text',
                    'answer', coalesce(nullif(v_ans ->> 'text', ''), tx ->> 'noAnswer'),
                    'reaction', coalesce(v_ans ->> 'reaction', ''))),
          'effects', case when v_k = v_n - 1 then v_eff else '[]'::jsonb end,
          'apply', case when v_k = 0 then jsonb_build_array(jsonb_build_object('type', 'interview', 'interview_id', iv.id))
                        else '[]'::jsonb end,
          'subject', v_subj,
          'ord', v_ord + v_k);
      end loop;
    else
      v_out := v_out || jsonb_build_object(
        'kind', 'interview',
        'mood', coalesce(public.company_interview_line(cfg #> '{moods,none}'), 'angry'),
        'headline', public.company_interview_fill(tx ->> 'noCommentHeadline', v_vals),
        'text', public.company_interview_fill(public.company_interview_line(
                  tx -> case when iv.status = 'declined' then 'declined' else 'ignored' end), v_vals),
        'effects', v_eff,
        'apply', jsonb_build_array(jsonb_build_object('type', 'interview', 'interview_id', iv.id)),
        'subject', v_subj,
        'ord', v_ord);
    end if;
  end loop;
  return v_out;
end;
$$;

-- news_show_build(): the interview joins the show before the topics are drawn (they then skip the CEO)
do $do$
declare
  v_def  text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old  text := $t$  v_segs := v_segs || public.news_show_topics(p_now, v_seen, v_skip_p, v_segs);$t$;
begin
  if position('news_show_interviews' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the call of news_show_interviews() (ADR-173) by hand';
    end if;
    execute replace(v_def, v_old, $t$  -- 11. a CEO interview (ADR-173): the questions, the answers and his reactions
  v_segs := v_segs || public.news_show_interviews(p_now);
$t$ || v_old);
  end if;
end;
$do$;

-- news_show_start(): an aired interview is marked once; the feed files interviews under companies
do $do$
declare
  v_def  text := pg_get_functiondef('public.news_show_start(bigint, timestamptz)'::regprocedure);
  v_when text := $t$        when 'tasks' then$t$;
  v_kind text := $t$when seg ->> 'kind' in ('scandal', 'hype', 'stock', 'tax', 'corp') then 'company'$t$;
begin
  if position('company_interviews' in v_def) = 0 then
    if position(v_when in v_def) = 0 or position(v_kind in v_def) = 0 then
      raise exception 'news_show_start() has an unexpected shape; add the apply type "interview" (ADR-173) by hand';
    end if;
    v_def := replace(v_def, v_when, $t$        when 'interview' then
          update public.company_interviews i set aired_at = p_now, show_id = s.id
           where i.id = (a ->> 'interview_id')::bigint and i.aired_at is null;
$t$ || v_when);
    v_def := replace(v_def, v_kind,
      $t$when seg ->> 'kind' in ('scandal', 'hype', 'stock', 'tax', 'corp', 'interview') then 'company'$t$);
    execute v_def;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- F. Grants and the job
-- ---------------------------------------------------------------------------
revoke all on function public.interviews_cfg() from public, anon, authenticated;
revoke all on function public.company_interview_facts(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.company_interview_when(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.company_interview_chance_bps(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.company_interview_fill(text, jsonb) from public, anon, authenticated;
revoke all on function public.company_interview_line(jsonb) from public, anon, authenticated;
revoke all on function public.company_interview_judge(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.company_interview_finish(bigint, text, jsonb, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.company_interview_request(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.company_interviews_run_due(timestamptz) from public, anon, authenticated;
revoke all on function public.company_interview_json(uuid) from public, anon, authenticated;
revoke all on function public.news_show_interviews(timestamptz) from public, anon, authenticated;
grant execute on function public.company_interviews_run_due(timestamptz) to service_role;
revoke all on function public.get_company_interview() from public, anon;
revoke all on function public.answer_company_interview(uuid, bigint, jsonb) from public, anon;
revoke all on function public.decline_company_interview(uuid, bigint) from public, anon;
grant execute on function public.get_company_interview() to authenticated;
grant execute on function public.answer_company_interview(uuid, bigint, jsonb) to authenticated;
grant execute on function public.decline_company_interview(uuid, bigint) to authenticated;
comment on function public.get_company_interview() is
  'RPC: the caller''s CEO interview (ADR-173): the open request with its questions and quick answers, or the latest result.';
comment on function public.answer_company_interview(uuid, bigint, jsonb) is
  'RPC: answers an interview, p_answers = [{text} | {quick}] per question; errors interview_text_invalid (NX261), '
  'interview_not_found (NX260), interview_closed (NX262).';
comment on function public.decline_company_interview(uuid, bigint) is
  'RPC: "kein Kommentar" to an interview request (ADR-173); errors interview_not_found, interview_closed.';

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-company-interviews';
    perform cron.schedule('nexa-company-interviews', '17 * * * *', 'select public.company_interviews_run_due()');
  end if;
end;
$do$;
