-- =============================================================================
-- NEXA · 7000 · Art quality: the critics judge every NFT (ADR-181)
-- =============================================================================
-- Every NFT gets a critic's score 0..100 from its pixel grid, computed by the server (never by the client) when it is
-- inserted, and once for all existing NFTs (oldest first, so the original keeps its score and later copies are
-- flagged). Port of src/lib/sim/art-quality.ts with the same integer arithmetic; shared cases in
-- supabase/tests/art_quality_cases.inc. Sub-scores: coverage, colours, harmony, contrast, structure, outline,
-- composition, detail, shapes (0..100 each, weights in nfts.quality). Identical or recoloured copies of an older NFT
-- (copy = exact) and near-copies (at most nearCopyPct of the pixels differ) are capped and flagged.
-- New columns: artworks.quality, quality_detail (sub-scores, best, worst, copy), quality_sig (copy signature).
-- Idempotent: runs unchanged as supabase/updates/20261204007000_nft_quality.sql.

alter table public.artworks add column if not exists quality smallint check (quality is null or quality between 0 and 100);
alter table public.artworks add column if not exists quality_detail jsonb;
alter table public.artworks add column if not exists quality_sig text;
create index if not exists artworks_quality_sig_idx on public.artworks (md5(quality_sig)) where quality_sig is not null;
comment on column public.artworks.quality is 'ADR-181: critic score 0..100 from the pixel grid (art_quality), set by the server.';
comment on column public.artworks.quality_detail is
  'ADR-181: {"sub": {coverage, colours, harmony, contrast, structure, outline, composition, detail, shapes}, "best", "worst", "copy": exact|near|null}.';
comment on column public.artworks.quality_sig is 'ADR-181: grid with colours renamed by first appearance (copy detection).';

-- The rating needs nfts.quality before the new game_config is written (update-to-latest writes it at the end)
update public.game_config set value = jsonb_set(value, '{quality}', '{"coverageMinPct":15,"dominanceMaxPct":90,"colourScores":[0,20,55,80,100,100,100,100,100,90,85,80,75,70,65,60,55],"strayPct":1,"strayPenalty":8,"chromaMinPct":20,"hueBuckets":3,"huePenalty":14,"hueFloor":20,"contrastFull":160,"noiseFreePct":5,"fragmentFreePct":10,"detailMin":40,"detailMax":350,"shapeFullPct":40,"balanceFreePct":10,"nearCopyPct":2,"copyCap":5,"nearCopyCap":15,"gateBase":30,"weights":{"coverage":10,"colours":12,"harmony":12,"contrast":10,"structure":16,"outline":8,"composition":10,"detail":10,"shapes":12}}'::jsonb)
 where key = 'nfts' and not (value ? 'quality');

-- artSignature: "." empty, colours renamed a, b, c ... in order of first appearance (equal hex values are one colour)
create or replace function public.art_signature(p_pixels jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pal   jsonb := p_pixels -> 'palette';
  v_np    integer := coalesce(jsonb_array_length(p_pixels -> 'palette'), 0);
  v_size  integer := coalesce(jsonb_array_length(p_pixels -> 'grid'), 0);
  v_hex   text[] := '{}';
  v_name  text[] := '{}';
  v_row   text;
  v_ch    text;
  v_i     integer;
  v_h     text;
  v_pos   integer;
  v_out   text := '';
begin
  for y in 0 .. v_size - 1 loop
    v_row := p_pixels -> 'grid' ->> y;
    for x in 1 .. v_size loop
      v_ch := substr(v_row, x, 1);
      v_i := position(v_ch in '0123456789abcdef') - 1;
      if v_ch = '' or v_i < 0 or v_i >= v_np then
        v_out := v_out || '.';
      else
        v_h := lower(v_pal ->> v_i);
        v_pos := array_position(v_hex, v_h);
        if v_pos is null then
          v_hex := v_hex || v_h;
          v_pos := cardinality(v_hex);
        end if;
        v_out := v_out || substr('abcdefghijklmnop', v_pos, 1);
      end if;
    end loop;
  end loop;
  return v_out;
end;
$$;

-- artCopyKind against the older NFTs (all others but p_self, created before p_before): exact | near | null
create or replace function public.art_copy_kind(p_sig text, p_self uuid, p_before timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := floor(char_length(p_sig) * coalesce((public.nfts_cfg() #>> '{quality,nearCopyPct}')::integer, 2) / 100.0)::integer;
  v_drawn integer := char_length(replace(p_sig, '.', ''));
  r       record;
  v_diff  integer;
begin
  if p_sig is null or p_sig = '' then
    return null;
  end if;
  if exists (select 1 from public.artworks a where md5(a.quality_sig) = md5(p_sig) and a.quality_sig = p_sig
               and a.id is distinct from p_self and a.created_at <= p_before) then
    return 'exact';
  end if;
  for r in select a.quality_sig as sig from public.artworks a
            where a.quality_sig is not null and a.id is distinct from p_self and a.created_at <= p_before
              and char_length(a.quality_sig) = char_length(p_sig)
              and abs(char_length(replace(a.quality_sig, '.', '')) - v_drawn) <= v_limit
            limit 500 loop
    select count(*) into v_diff from generate_series(1, char_length(p_sig)) i
     where substr(r.sig, i, 1) <> substr(p_sig, i, 1);
    if v_diff <= v_limit then
      return 'near';
    end if;
  end loop;
  return null;
end;
$$;

-- artQuality: the critic's score and sub-scores (see src/lib/sim/art-quality.ts)
create or replace function public.art_quality(p_pixels jsonb, p_copy text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q        jsonb := public.nfts_cfg() -> 'quality';
  v_pal    jsonb := p_pixels -> 'palette';
  v_np     integer := coalesce(jsonb_array_length(p_pixels -> 'palette'), 0);
  v_size   integer := coalesce(jsonb_array_length(p_pixels -> 'grid'), 0);
  v_n      integer;
  v_hex    text[] := '{}';
  v_idof   integer[] := '{}';
  v_r      integer[] := '{}';
  v_g      integer[] := '{}';
  v_b      integer[] := '{}';
  v_lum    integer[] := '{}';
  v_cells  integer[];
  v_cnt    integer[];
  v_empty  integer := 0;
  v_drawn  integer := 0;
  v_sx     bigint := 0;
  v_sy     bigint := 0;
  v_row    text;
  v_i      integer;
  v_c      integer;
  v_o      integer;
  v_k      integer := 0;
  v_stray  integer := 0;
  v_maxc   integer;
  v_dom    integer;
  v_cov    integer;
  v_col    integer;
  v_harm   integer;
  v_con    integer;
  v_str    integer;
  v_out    integer;
  v_comp   integer;
  v_det    integer;
  v_shp    integer;
  v_minl   integer := 1000;
  v_maxl   integer := -1;
  v_thr    integer;
  v_bk     integer[] := '{}';
  v_mx     integer;
  v_mn     integer;
  v_d      integer;
  v_h      integer;
  v_iso    integer := 0;
  v_solid  integer := 0;
  v_bound  integer := 0;
  v_dark   integer := 0;
  v_trans  integer := 0;
  v_same   integer;
  v_isemp  boolean;
  v_seen   boolean[];
  v_stack  integer[];
  v_top    integer;
  v_j      integer;
  v_reg    integer := 0;
  v_noise  integer;
  v_frag   integer;
  v_off    integer;
  v_bal    integer;
  v_ph     integer := 0;
  v_mh     integer := 0;
  v_pv     integer := 0;
  v_mv     integer := 0;
  v_sym    integer;
  v_e      integer;
  v_sum    bigint := 0;
  v_sumw   bigint := 0;
  v_score  integer;
  v_gate   integer;
  v_sub    jsonb;
  v_best   text;
  v_worst  text;
  v_keys   text[] := array['coverage', 'colours', 'harmony', 'contrast', 'structure', 'outline', 'composition', 'detail', 'shapes'];
  v_key    text;
  v_tab    jsonb := q -> 'colourScores';
  v_chroma integer := (q ->> 'chromaMinPct')::integer;
begin
  -- palette: equal hex values share one colour id (1-based here)
  for v_i in 0 .. v_np - 1 loop
    v_row := lower(v_pal ->> v_i);
    v_c := array_position(v_hex, v_row);
    if v_c is null then
      v_hex := v_hex || v_row;
      v_c := cardinality(v_hex);
      v_r := v_r || ('x' || substr(v_row, 2, 2))::bit(8)::integer;
      v_g := v_g || ('x' || substr(v_row, 4, 2))::bit(8)::integer;
      v_b := v_b || ('x' || substr(v_row, 6, 2))::bit(8)::integer;
      v_lum := v_lum || ((299 * v_r[v_c] + 587 * v_g[v_c] + 114 * v_b[v_c]) / 1000);
    end if;
    v_idof := v_idof || v_c;
  end loop;
  v_n := v_size * v_size;
  v_cells := array_fill(0, array[greatest(v_n, 1)]);
  v_cnt := array_fill(0, array[greatest(cardinality(v_hex), 1)]);
  for y in 0 .. v_size - 1 loop
    v_row := p_pixels -> 'grid' ->> y;
    for x in 0 .. v_size - 1 loop
      v_i := position(substr(coalesce(v_row, ''), x + 1, 1) in '0123456789abcdef') - 1;
      if substr(coalesce(v_row, ''), x + 1, 1) <> '' and v_i >= 0 and v_i < v_np then
        v_c := v_idof[v_i + 1];
        v_cells[y * v_size + x + 1] := v_c;
        v_cnt[v_c] := v_cnt[v_c] + 1;
        v_drawn := v_drawn + 1;
        v_sx := v_sx + x;
        v_sy := v_sy + y;
      else
        v_empty := v_empty + 1;
      end if;
    end loop;
  end loop;
  if v_drawn = 0 or v_size < 2 then
    return jsonb_build_object('score', 0, 'sub', (select jsonb_object_agg(k, 0) from unnest(v_keys) k),
                              'best', 'coverage', 'worst', 'coverage', 'copy', p_copy);
  end if;

  -- coverage
  v_cov := least(100, (v_drawn::bigint * 10000 / (v_n * (q ->> 'coverageMinPct')::integer))::integer);
  v_maxc := v_empty;
  for v_c in 1 .. cardinality(v_hex) loop
    v_maxc := greatest(v_maxc, v_cnt[v_c]);
    if v_cnt[v_c] > 0 then
      v_k := v_k + 1;
      if v_cnt[v_c] * 100 < v_drawn * (q ->> 'strayPct')::integer then
        v_stray := v_stray + 1;
      end if;
      v_minl := least(v_minl, v_lum[v_c]);
      v_maxl := greatest(v_maxl, v_lum[v_c]);
      -- hue bucket of a saturated colour
      v_mx := greatest(v_r[v_c], v_g[v_c], v_b[v_c]);
      v_mn := least(v_r[v_c], v_g[v_c], v_b[v_c]);
      v_d := v_mx - v_mn;
      if v_mx > 0 and v_d > 0 and v_d * 100 / v_mx >= v_chroma and v_mx * 100 / 255 >= v_chroma then
        if v_mx = v_r[v_c] then
          v_h := (60 * (v_g[v_c] - v_b[v_c]) + 360 * v_d) / v_d;
        elsif v_mx = v_g[v_c] then
          v_h := (60 * (v_b[v_c] - v_r[v_c]) + 120 * v_d) / v_d;
        else
          v_h := (60 * (v_r[v_c] - v_g[v_c]) + 240 * v_d) / v_d;
        end if;
        v_h := (v_h % 360) / 30;
        if array_position(v_bk, v_h) is null then
          v_bk := v_bk || v_h;
        end if;
      end if;
    end if;
  end loop;
  v_dom := v_maxc * 100 / v_n;
  if v_dom > (q ->> 'dominanceMaxPct')::integer then
    v_cov := least(v_cov, (100 - v_dom) * 10);
  end if;

  -- colours, harmony, contrast
  v_col := greatest(0, least(100, (v_tab ->> least(v_k, jsonb_array_length(v_tab) - 1))::integer
                                  - v_stray * (q ->> 'strayPenalty')::integer));
  v_harm := case when cardinality(v_bk) <= (q ->> 'hueBuckets')::integer then 100
                 else greatest((q ->> 'hueFloor')::integer,
                               100 - (cardinality(v_bk) - (q ->> 'hueBuckets')::integer) * (q ->> 'huePenalty')::integer) end;
  v_con := least(100, (v_maxl - v_minl) * 100 / (q ->> 'contrastFull')::integer);
  v_thr := v_minl + (v_maxl - v_minl) / 3;

  -- neighbours
  for y in 0 .. v_size - 1 loop
    for x in 0 .. v_size - 1 loop
      v_i := y * v_size + x + 1;
      v_c := v_cells[v_i];
      if x + 1 < v_size and v_cells[v_i + 1] <> v_c then
        v_trans := v_trans + 1;
      end if;
      if y + 1 < v_size and v_cells[v_i + v_size] <> v_c then
        v_trans := v_trans + 1;
      end if;
      continue when v_c = 0;
      v_same := 0;
      v_isemp := false;
      if x > 0 then
        v_o := v_cells[v_i - 1];
        if v_o = v_c then v_same := v_same + 1; elsif v_o = 0 then v_isemp := true; end if;
      end if;
      if x + 1 < v_size then
        v_o := v_cells[v_i + 1];
        if v_o = v_c then v_same := v_same + 1; elsif v_o = 0 then v_isemp := true; end if;
      end if;
      if y > 0 then
        v_o := v_cells[v_i - v_size];
        if v_o = v_c then v_same := v_same + 1; elsif v_o = 0 then v_isemp := true; end if;
      end if;
      if y + 1 < v_size then
        v_o := v_cells[v_i + v_size];
        if v_o = v_c then v_same := v_same + 1; elsif v_o = 0 then v_isemp := true; end if;
      end if;
      if v_same = 0 then v_iso := v_iso + 1; end if;
      if v_same >= 3 then v_solid := v_solid + 1; end if;
      if v_isemp then
        v_bound := v_bound + 1;
        if v_lum[v_c] <= v_thr then v_dark := v_dark + 1; end if;
      end if;
    end loop;
  end loop;

  -- regions: 4-connected, same colour (iterative flood fill)
  v_seen := array_fill(false, array[v_n]);
  v_stack := array_fill(0, array[v_n]);
  for v_i in 1 .. v_n loop
    continue when v_cells[v_i] = 0 or v_seen[v_i];
    v_reg := v_reg + 1;
    v_seen[v_i] := true;
    v_top := 1;
    v_stack[1] := v_i;
    while v_top > 0 loop
      v_j := v_stack[v_top];
      v_top := v_top - 1;
      v_c := v_cells[v_j];
      -- left, right, up, down (0-based x = (v_j - 1) % size)
      if (v_j - 1) % v_size > 0 and not v_seen[v_j - 1] and v_cells[v_j - 1] = v_c then
        v_seen[v_j - 1] := true; v_top := v_top + 1; v_stack[v_top] := v_j - 1;
      end if;
      if (v_j - 1) % v_size + 1 < v_size and not v_seen[v_j + 1] and v_cells[v_j + 1] = v_c then
        v_seen[v_j + 1] := true; v_top := v_top + 1; v_stack[v_top] := v_j + 1;
      end if;
      if v_j > v_size and not v_seen[v_j - v_size] and v_cells[v_j - v_size] = v_c then
        v_seen[v_j - v_size] := true; v_top := v_top + 1; v_stack[v_top] := v_j - v_size;
      end if;
      if v_j + v_size <= v_n and not v_seen[v_j + v_size] and v_cells[v_j + v_size] = v_c then
        v_seen[v_j + v_size] := true; v_top := v_top + 1; v_stack[v_top] := v_j + v_size;
      end if;
    end loop;
  end loop;
  v_noise := v_iso * 100 / v_drawn;
  v_frag := v_reg * 100 / v_drawn;
  v_str := (case when v_noise <= (q ->> 'noiseFreePct')::integer then 100
                 else greatest(0, 100 - (v_noise - (q ->> 'noiseFreePct')::integer) * 2) end
          + case when v_frag <= (q ->> 'fragmentFreePct')::integer then 100
                 else greatest(0, 100 - (v_frag - (q ->> 'fragmentFreePct')::integer) * 2) end) / 2;
  v_out := case when v_k < 2 then 40 when v_bound = 0 then 70 else 40 + v_dark * 60 / v_bound end;

  -- composition
  v_off := (abs(2 * v_sx - (v_size - 1)::bigint * v_drawn) * 100 / (v_drawn::bigint * v_size))::integer
         + (abs(2 * v_sy - (v_size - 1)::bigint * v_drawn) * 100 / (v_drawn::bigint * v_size))::integer;
  v_bal := case when v_off <= (q ->> 'balanceFreePct')::integer then 100
                else greatest(0, 100 - (v_off - (q ->> 'balanceFreePct')::integer) * 3) end;
  for a in 0 .. v_size - 1 loop
    for b in 0 .. v_size / 2 - 1 loop
      v_c := v_cells[a * v_size + b + 1];
      v_o := v_cells[a * v_size + v_size - b];
      if v_c <> 0 or v_o <> 0 then
        v_ph := v_ph + 1;
        if v_c = v_o then v_mh := v_mh + 1; end if;
      end if;
      v_c := v_cells[b * v_size + a + 1];
      v_o := v_cells[(v_size - 1 - b) * v_size + a + 1];
      if v_c <> 0 or v_o <> 0 then
        v_pv := v_pv + 1;
        if v_c = v_o then v_mv := v_mv + 1; end if;
      end if;
    end loop;
  end loop;
  v_sym := greatest(case when v_ph = 0 then 0 else v_mh * 100 / v_ph end, case when v_pv = 0 then 0 else v_mv * 100 / v_pv end);
  v_comp := (v_bal * 2 + v_sym) / 3;

  v_e := v_trans * 1000 / (2 * v_size * (v_size - 1));
  v_det := case when v_e < (q ->> 'detailMin')::integer then v_e * 100 / (q ->> 'detailMin')::integer
                when v_e <= (q ->> 'detailMax')::integer then 100
                else greatest(0, 100 - (v_e - (q ->> 'detailMax')::integer) / 4) end;
  v_shp := least(100, (v_solid::bigint * 10000 / (v_drawn::bigint * (q ->> 'shapeFullPct')::integer))::integer);

  v_sub := jsonb_build_object('coverage', v_cov, 'colours', v_col, 'harmony', v_harm, 'contrast', v_con,
                              'structure', v_str, 'outline', v_out, 'composition', v_comp, 'detail', v_det, 'shapes', v_shp);
  v_best := v_keys[1];
  v_worst := v_keys[1];
  foreach v_key in array v_keys loop
    v_sumw := v_sumw + (q #>> array['weights', v_key])::integer;
    v_sum := v_sum + (q #>> array['weights', v_key])::integer * (v_sub ->> v_key)::integer;
    if (v_sub ->> v_key)::integer > (v_sub ->> v_best)::integer then v_best := v_key; end if;
    if (v_sub ->> v_key)::integer < (v_sub ->> v_worst)::integer then v_worst := v_key; end if;
  end loop;
  v_gate := least(v_cov, v_col, v_det);
  v_score := ((v_sum / v_sumw) * ((q ->> 'gateBase')::integer * 100 + v_gate * (100 - (q ->> 'gateBase')::integer)) / 10000)::integer;
  if p_copy = 'exact' then
    v_score := least(v_score, (q ->> 'copyCap')::integer);
  elsif p_copy = 'near' then
    v_score := least(v_score, (q ->> 'nearCopyCap')::integer);
  end if;
  return jsonb_build_object('score', v_score, 'sub', v_sub, 'best', v_best, 'worst', v_worst, 'copy', p_copy);
end;
$$;
comment on function public.art_quality(jsonb, text) is 'Port of artQuality (src/lib/sim/art-quality.ts, ADR-181).';

-- Scores one NFT (copy check against older NFTs) and stores the result
create or replace function public.artwork_rate_quality(p_artwork uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a     public.artworks;
  v_sig text;
  v_q   jsonb;
begin
  select * into a from public.artworks where id = p_artwork;
  if a.id is null or public.nfts_cfg() -> 'quality' is null then
    return null;
  end if;
  v_sig := public.art_signature(a.pixels);
  v_q := public.art_quality(a.pixels, public.art_copy_kind(v_sig, a.id, a.created_at));
  update public.artworks set quality = (v_q ->> 'score')::smallint, quality_detail = v_q - 'score', quality_sig = v_sig
   where id = a.id;
  return (v_q ->> 'score')::integer;
end;
$$;

-- Every new NFT (player mint, gallery seed) is rated once, after insert; changing the pixels rates it again
create or replace function public.artworks_quality_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.artwork_rate_quality(new.id);
  return null;
end;
$$;
drop trigger if exists artworks_quality_ins on public.artworks;
create trigger artworks_quality_ins after insert on public.artworks
  for each row execute function public.artworks_quality_trigger();
drop trigger if exists artworks_quality_upd on public.artworks;
create trigger artworks_quality_upd after update of pixels on public.artworks
  for each row when (old.pixels is distinct from new.pixels) execute function public.artworks_quality_trigger();

revoke all on function public.art_signature(jsonb) from public, anon, authenticated;
revoke all on function public.art_copy_kind(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.art_quality(jsonb, text) from public, anon, authenticated;
revoke all on function public.artwork_rate_quality(uuid) from public, anon, authenticated;
revoke all on function public.artworks_quality_trigger() from public, anon, authenticated;
grant execute on function public.art_signature(jsonb) to service_role;
grant execute on function public.art_copy_kind(text, uuid, timestamptz) to service_role;
grant execute on function public.art_quality(jsonb, text) to service_role;
grant execute on function public.artwork_rate_quality(uuid) to service_role;

-- Backfill: oldest first, so an original is rated before its copies
do $do$
declare
  r record;
begin
  if public.nfts_cfg() -> 'quality' is null then
    return;
  end if;
  for r in select a.id from public.artworks a where a.quality is null order by a.created_at, a.serial loop
    perform public.artwork_rate_quality(r.id);
  end loop;
end;
$do$;
