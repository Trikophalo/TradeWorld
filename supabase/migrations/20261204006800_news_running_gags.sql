-- =============================================================================
-- NEXA · 6800 · Running gags in NEXA Nachrichten (ADR-179)
-- =============================================================================
-- * A running gag (newsShow.runningGags.<key>) comes back show after show while an active player company whose
--   name matches its namePattern (ILIKE) exists: with chanceBps per show, as a segment of kind "gag". First gag:
--   "Vulcan Energy" announces again and again that drilling starts soon, and never does.
-- * news_running_gags counts the aired episodes per gag and company (a new company with the name starts at 1)
--   and remembers the last line, so it never runs twice in a row; lines escalate with the episode.
-- * The made-up chat viewers react around the segment: annoyed lines, and a few die-hard fans with fixed names.
-- * Claude's rewrite (news-anchor) keeps the gag segment as drafted: it must name the player company and founder.
-- * Written idempotently; the copy in supabase/updates/ is identical below its header.
-- =============================================================================

create table if not exists public.news_running_gags (
  gag_key      text not null,
  company_id   uuid not null references public.companies (id) on delete cascade,
  episodes     integer not null default 0 check (episodes >= 0),
  last_line    integer,
  last_show_id bigint,
  first_at     timestamptz,
  last_at      timestamptz,
  primary key (gag_key, company_id)
);
alter table public.news_running_gags enable row level security;
comment on table public.news_running_gags is
  'Running gags of NEXA Nachrichten (ADR-179): aired episodes and the last host line per gag and player company. '
  'Server only (no policies).';

-- The company a gag is about right now: the oldest active player company with a matching name.
create or replace function public.news_running_gag_company(p_pattern text)
returns table (company_id uuid, company text, founder text, phase text, founded_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, coalesce(p.nickname, '?'), c.phase::text, c.founded_at
    from public.companies c
    left join public.profiles p on p.id = c.founder_id
   where not c.is_ai and c.dissolved_at is null and c.phase in ('private', 'ipo', 'listed')
     and p_pattern is not null and btrim(p_pattern) <> '' and c.name ilike p_pattern
   order by c.founded_at, c.id
   limit 1;
$$;

-- A random element of a json array, or null.
create or replace function public.news_running_gag_pick(p_list jsonb)
returns text
language sql
volatile
set search_path = ''
as $$
  select case when jsonb_typeof(p_list) = 'array' and jsonb_array_length(p_list) > 0
              then p_list ->> floor(random() * jsonb_array_length(p_list))::integer end;
$$;

-- The gag segments of a show (at most one per gag).
create or replace function public.news_show_running_gags(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gags    jsonb := coalesce(public.news_show_cfg() -> 'runningGags', '{}'::jsonb);
  g       record;
  c       record;
  st      public.news_running_gags;
  v_out   jsonb := '[]'::jsonb;
  v_ep    integer;
  v_total integer;
  v_pool  integer;
  v_line  integer;
  v_i     integer;
  v_vals  jsonb;
  v_text  text;
  v_extra text;
begin
  if jsonb_typeof(gags) <> 'object' then
    return v_out;
  end if;
  for g in select key, value from jsonb_each(gags) where jsonb_typeof(value) = 'object' loop
    continue when not coalesce((g.value ->> 'enabled')::boolean, false);
    select * into c from public.news_running_gag_company(g.value ->> 'namePattern');
    continue when c.company_id is null;
    continue when random() * 10000 >= coalesce((g.value ->> 'chanceBps')::integer, 0);
    v_total := jsonb_array_length(coalesce(g.value -> 'lines', '[]'::jsonb));
    continue when v_total = 0;
    select * into st from public.news_running_gags r where r.gag_key = g.key and r.company_id = c.company_id;
    v_ep := coalesce(st.episodes, 0) + 1;
    -- escalation: episode e may use the first escalateStart + (e - 1) * escalatePerEpisode lines
    v_pool := greatest(1, least(v_total, coalesce((g.value ->> 'escalateStart')::integer, v_total)
                                         + (v_ep - 1) * coalesce((g.value ->> 'escalatePerEpisode')::integer, 0)));
    -- never the line of the last aired episode
    if v_pool <= 1 then
      v_line := 0;
    elsif st.last_line is null or st.last_line < 0 or st.last_line >= v_pool then
      v_line := least(v_pool - 1, floor(random() * v_pool)::integer);
    else
      v_i := least(v_pool - 2, floor(random() * (v_pool - 1))::integer);
      v_line := case when v_i >= st.last_line then v_i + 1 else v_i end;
    end if;
    v_vals := jsonb_build_object(
      'company', c.company, 'founder', c.founder, 'episode', v_ep,
      'days', greatest(1, floor(extract(epoch from (p_now - c.founded_at)) / 86400)::integer + 1),
      'when', coalesce(public.news_running_gag_pick(g.value -> 'whens'), 'bald'));
    v_extra := case when c.phase in ('ipo', 'listed') then public.news_running_gag_pick(g.value #> array['phaseLines', c.phase]) end;
    v_text := public.company_interview_fill(public.news_running_gag_pick(g.value -> 'intros'), v_vals) || ' '
              || public.company_interview_fill(g.value -> 'lines' -> v_line ->> 'text', v_vals)
              || coalesce(' ' || public.company_interview_fill(v_extra, v_vals), '');
    v_out := v_out || jsonb_build_object(
      'kind', 'gag',
      'mood', case when g.value -> 'lines' -> v_line ->> 'mood'
                        in ('neutral', 'shocked', 'crying', 'laughing', 'angry', 'smug', 'confused', 'proud')
                   then g.value -> 'lines' -> v_line ->> 'mood' else 'confused' end,
      'headline', left(public.company_interview_fill(public.news_running_gag_pick(g.value -> 'headlines'), v_vals), 90),
      'text', v_text,
      'effects', '[]'::jsonb,
      'apply', jsonb_build_array(jsonb_build_object('type', 'gag', 'gag', g.key, 'company_id', c.company_id, 'line', v_line)),
      'subject', jsonb_build_object('type', 'gag', 'gag', g.key, 'company_id', c.company_id, 'name', c.company,
                                    'company', c.company, 'values', v_vals),
      'ord', coalesce((g.value ->> 'ord')::integer, 75));
  end loop;
  return v_out;
end;
$$;

-- The made-up viewers around a gag segment: annoyed lines from the usual names, the fans under their own names.
create or replace function public.news_show_gag_chat(p_show_id bigint, p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.news_show_cfg();
  names   jsonb := coalesce(public.news_show_cfg() #> '{chat,bots,names}', '[]'::jsonb);
  s       public.news_shows;
  seg     jsonb;
  gc      jsonb;
  v_idx   bigint;
  v_intro numeric := coalesce((cfg ->> 'introSeconds')::numeric, 8);
  v_seg   numeric := greatest(1, coalesce((cfg ->> 'segmentSeconds')::numeric, 22));
  v_lead  numeric;
  v_span  numeric;
  v_n     integer := 0;
  v_k     integer;
begin
  select * into s from public.news_shows where id = p_show_id;
  if s.id is null then
    return 0;
  end if;
  for seg, v_idx in select x, ord from jsonb_array_elements(s.segments) with ordinality t(x, ord) where x ->> 'kind' = 'gag' loop
    gc := cfg #> array['runningGags', seg -> 'subject' ->> 'gag', 'chat'];
    continue when gc is null;
    v_lead := coalesce((gc ->> 'leadSeconds')::numeric, 0);
    v_span := v_lead + v_seg + coalesce((gc ->> 'tailSeconds')::numeric, 0);
    -- annoyed viewers (no line twice in a segment)
    if jsonb_array_length(names) > 0 then
      insert into public.news_show_messages (player_id, bot_name, body, created_at)
      select null, names ->> floor(random() * jsonb_array_length(names))::integer,
             left(public.company_interview_fill(l, seg -> 'subject' -> 'values'), 300),
             p_now + make_interval(secs => (v_intro + (v_idx - 1) * v_seg - v_lead + random() * v_span)::double precision)
        from (select l from jsonb_array_elements_text(coalesce(gc -> 'annoyed', '[]'::jsonb)) l
               order by random() limit greatest(0, coalesce((gc ->> 'annoyedPerSegment')::integer, 0))) a;
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    end if;
    -- the die-hard fans
    if jsonb_array_length(coalesce(gc -> 'fanNames', '[]'::jsonb)) > 0 then
      insert into public.news_show_messages (player_id, bot_name, body, created_at)
      select null, public.news_running_gag_pick(gc -> 'fanNames'),
             left(public.company_interview_fill(l, seg -> 'subject' -> 'values'), 300),
             p_now + make_interval(secs => (v_intro + (v_idx - 1) * v_seg - v_lead + random() * v_span)::double precision)
        from (select l from jsonb_array_elements_text(coalesce(gc -> 'fans', '[]'::jsonb)) l
               order by random() limit greatest(0, coalesce((gc ->> 'fansPerSegment')::integer, 0))) f;
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    end if;
  end loop;
  return v_n;
end;
$$;

-- news_show_build(): the gag joins the show
do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old text := $t$  v_segs := v_segs || public.news_show_interviews(p_now);$t$;
begin
  if position('news_show_running_gags' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the call of news_show_running_gags() (ADR-179) by hand';
    end if;
    execute replace(v_def, v_old, $t$  -- 12. running gags (ADR-179): back every show while their player company exists
  v_segs := v_segs || public.news_show_running_gags(p_now);
$t$ || v_old);
  end if;
end;
$do$;

-- news_show_start(): an aired gag counts as an episode (once per show); the feed files it under companies
do $do$
declare
  v_def  text := pg_get_functiondef('public.news_show_start(bigint, timestamptz)'::regprocedure);
  v_when text := $t$        when 'tasks' then$t$;
  v_kind text := $t$'corp', 'interview') then 'company'$t$;
begin
  if position('news_running_gags' in v_def) = 0 then
    if position(v_when in v_def) = 0 or position(v_kind in v_def) = 0 then
      raise exception 'news_show_start() has an unexpected shape; add the apply type "gag" (ADR-179) by hand';
    end if;
    v_def := replace(v_def, v_when, $t$        when 'gag' then
          if exists (select 1 from public.companies c where c.id = (a ->> 'company_id')::uuid) then
            insert into public.news_running_gags as rg (gag_key, company_id, episodes, last_line, last_show_id, first_at, last_at)
            values (a ->> 'gag', (a ->> 'company_id')::uuid, 1, (a ->> 'line')::integer, s.id, p_now, p_now)
            on conflict (gag_key, company_id) do update
              set episodes = rg.episodes + 1, last_line = excluded.last_line, last_show_id = excluded.last_show_id,
                  last_at = excluded.last_at
              where rg.last_show_id is distinct from excluded.last_show_id;
          end if;
$t$ || v_when);
    v_def := replace(v_def, v_kind, $t$'corp', 'interview', 'gag') then 'company'$t$);
    execute v_def;
  end if;
end;
$do$;

-- news_show_after_start(): the viewers react to the gag
do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_after_start(bigint, timestamptz)'::regprocedure);
  v_old text := $t$  return v_n;
end;$t$;
begin
  if position('news_show_gag_chat' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_after_start() has an unexpected shape; add the call of news_show_gag_chat() (ADR-179) by hand';
    end if;
    execute replace(v_def, v_old, $t$  -- running gags (ADR-179): annoyed viewers and die-hard fans around the segment
  v_n := v_n + public.news_show_gag_chat(p_show_id, p_now);
$t$ || v_old);
  end if;
end;
$do$;

-- store_news_show_script(): Claude's rewrite keeps gag segments as drafted (they name the player company)
do $do$
declare
  v_def text := pg_get_functiondef('public.store_news_show_script(bigint, jsonb)'::regprocedure);
  v_old text := $t$  update public.news_shows set segments = v_new, writer = 'claude' where id = s.id;$t$;
begin
  if position('''gag''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'store_news_show_script() has an unexpected shape; keep gag segments (ADR-179) by hand';
    end if;
    execute replace(v_def, v_old, $t$  -- running gags (ADR-179) stay as drafted
  select jsonb_agg(case when o.x ->> 'kind' = 'gag' then o.x else n.x end order by o.ord) into v_new
    from jsonb_array_elements(s.segments) with ordinality o(x, ord)
    join jsonb_array_elements(v_new) with ordinality n(x, ord) using (ord);
$t$ || v_old);
  end if;
end;
$do$;

revoke all on function public.news_running_gag_company(text) from public, anon, authenticated;
revoke all on function public.news_running_gag_pick(jsonb) from public, anon, authenticated;
revoke all on function public.news_show_running_gags(timestamptz) from public, anon, authenticated;
revoke all on function public.news_show_gag_chat(bigint, timestamptz) from public, anon, authenticated;
