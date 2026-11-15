-- ===== idempotent copy of migrations/20261204002400_share_supply.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 2400 · Stocks have a supply: nobody holds more shares than exist (ADR-153)
-- =============================================================================
-- Until now the market sold any number of shares, so players could hold more shares of a company than it has.
-- Now a buy order takes at most the free float: the company's shares minus what players hold and minus what open
-- buy orders already wait for. With no share left a buy fails with "no_shares_left" (NX129); shares come back
-- when somebody sells, and new ones when the founder runs a capital increase. Positions above the supply that
-- exist already stay as they are; they only block further buying until enough was sold.
-- Idempotent: runs unchanged as supabase/updates/20261204002400_share_supply.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''no_shares_left''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'chat_text_invalid'          then 'NX128'
$q$, $q$    when 'chat_text_invalid'          then 'NX128'
    when 'no_shares_left'             then 'NX129'
$q$);
    if position('''no_shares_left''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the share supply error key by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- Shares (e6) of a stock that can still be bought: all shares of the company minus the players' holdings and the
-- open rest of their buy orders. Null = no limit (bonds, securities without a company).
create or replace function public.security_free_float_e6(p_security uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0,
           c.shares_outstanding * 1000000
           - coalesce((select sum(p.quantity_e6) from public.positions p
                        where p.security_id = s.id and p.status = 'open' and p.side = 'long'), 0)
           - coalesce((select sum(o.quantity_e6 - o.filled_quantity_e6) from public.orders o
                        where o.security_id = s.id and o.side = 'buy'
                          and o.status in ('pending', 'open', 'partially_filled')), 0))::bigint
    from public.securities s join public.companies c on c.id = s.company_id
   where s.id = p_security and s.kind = 'stock' and c.shares_outstanding is not null;
$$;
revoke all on function public.security_free_float_e6(uuid) from public, anon, authenticated;
grant execute on function public.security_free_float_e6(uuid) to service_role;
comment on function public.security_free_float_e6(uuid) is
  'Internal: shares (e6) of a stock still free to buy: shares outstanding minus players'' holdings and open buy orders (ADR-153).';

-- place_order(): a buy takes at most the free float (the function is otherwise unchanged).
do $do$
declare
  v_def text := pg_get_functiondef('public.place_order(uuid, text, text, text, bigint, bigint, bigint)'::regprocedure);
  v_at  text := $t$  -- minimum order value at the price it would execute or rest at$t$;
  v_new text := $t$  -- ADR-153: a stock has a supply. Buyers of one stock go one after the other, so the float cannot be oversold.
  if v_side = 'buy' and s.kind = 'stock' then
    perform 1 from public.securities x where x.id = s.id for update;
    if public.security_free_float_e6(s.id) is not null then
      if public.security_free_float_e6(s.id) < 1 then
        perform public.api_error('no_shares_left');
      end if;
      v_qty := least(v_qty, public.security_free_float_e6(s.id));
    end if;
  end if;

$t$;
begin
  if position('security_free_float_e6' in v_def) = 0 then
    if position(v_at in v_def) = 0 then
      raise exception 'place_order() has an unexpected shape; add the share supply check by hand';
    end if;
    execute replace(v_def, v_at, v_new || v_at);
  end if;
end;
$do$;
