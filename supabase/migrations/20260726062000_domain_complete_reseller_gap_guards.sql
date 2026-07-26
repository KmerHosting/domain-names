create or replace function public.domain_catalog_price(p_payload jsonb, p_kind text)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  with selected_group as (
    select g.value as group_payload
    from jsonb_array_elements(coalesce(p_payload->'prices','[]'::jsonb)) as g(value)
    order by case when lower(coalesce(g.value->>'priceGroup','')) = 'reseller' then 0 else 1 end
    limit 1
  ), selected_price as (
    select (price.value->>'price')::numeric as price
    from selected_group sg,
         jsonb_array_elements(coalesce(sg.group_payload->p_kind,'[]'::jsonb)) as price(value)
    where coalesce(price.value->>'currency','USD') = 'USD'
      and coalesce((price.value->>'price')::numeric, 0) > 0
    order by case when nullif(price.value->>'period','')::int = 1 then 0 else 1 end,
             nullif(price.value->>'period','')::int nulls last
    limit 1
  )
  select price from selected_price;
$$;

drop view if exists public.domain_public_tld_prices;
create view public.domain_public_tld_prices
with (security_invoker = true)
as
select
  tld,
  enabled,
  popular,
  is_promo,
  registration_price_usd,
  renewal_price_usd,
  transfer_price_usd,
  min_years,
  max_years,
  supports_privacy,
  provider_available
from public.domain_tld_prices
where enabled = true
  and provider_available = true
  and coalesce(registration_price_usd, 0) > 0;

revoke all on public.domain_public_tld_prices from public, anon, authenticated;
grant select on public.domain_public_tld_prices to anon, authenticated;

alter table public.domain_forwarding_rules
  add column if not exists domain_id uuid references public.domain_domains(id) on delete cascade,
  add column if not exists user_id uuid references public.domain_users(id) on delete cascade,
  add column if not exists redirect_url text,
  add column if not exists forward_type text,
  add column if not exists status text not null default 'active',
  add column if not exists provider_payload jsonb,
  add column if not exists synced_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists domain_forwarding_rules_domain_id_idx
  on public.domain_forwarding_rules(domain_id);
create index if not exists domain_forwarding_rules_user_id_idx
  on public.domain_forwarding_rules(user_id);

alter table public.domain_glue_hosts
  add column if not exists domain_id uuid references public.domain_domains(id) on delete cascade,
  add column if not exists user_id uuid references public.domain_users(id) on delete cascade,
  add column if not exists host_name text,
  add column if not exists ip_addresses text[] not null default '{}',
  add column if not exists status text not null default 'active',
  add column if not exists provider_payload jsonb,
  add column if not exists synced_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists domain_glue_hosts_domain_host_idx
  on public.domain_glue_hosts(domain_id, host_name);
create index if not exists domain_glue_hosts_user_id_idx
  on public.domain_glue_hosts(user_id);

create table if not exists public.domain_provider_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.domain_users(id) on delete cascade,
  domain_id uuid references public.domain_domains(id) on delete cascade,
  order_id uuid references public.domain_orders(id) on delete set null,
  domain_name text not null,
  tld text not null,
  operation text not null check (operation in ('registration','renewal','transfer','restore')),
  period_years integer not null default 1,
  provider_cost_usd numeric(12,2),
  customer_price_usd numeric(12,2),
  eligible boolean not null default false,
  source text not null default 'provider_catalog',
  provider_payload jsonb,
  reason text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);
create index if not exists domain_provider_quotes_user_idx on public.domain_provider_quotes(user_id, created_at desc);
create index if not exists domain_provider_quotes_domain_idx on public.domain_provider_quotes(domain_id, operation, created_at desc);

alter table public.domain_orders
  add column if not exists provider_quote_id uuid references public.domain_provider_quotes(id) on delete set null,
  add column if not exists provider_checked_at timestamptz,
  add column if not exists provider_required_cost_usd numeric(12,2),
  add column if not exists provider_balance_checked_at timestamptz;

create or replace view public.domain_operational_issues
with (security_invoker = true)
as
select 'active_failed_jobs'::text as issue, count(*)::bigint as count
from public.domain_jobs
where status in ('failed','running') and archived_at is null
union all
select 'orders_processing_over_30_min', count(*)::bigint
from public.domain_orders
where status = 'processing' and updated_at < now() - interval '30 minutes'
union all
select 'paid_cancelled_or_failed_orders_needing_refund', count(*)::bigint
from public.domain_orders o
where o.status in ('cancelled','failed') and o.paid_at is not null
  and not exists (
    select 1 from public.domain_wallet_transactions t
    where t.user_id = o.user_id
      and t.transaction_type = 'refund_credit'
      and (t.metadata->>'orderId')::uuid = o.id
  )
union all
select 'paid_orders_not_completed_or_failed_over_30_min', count(*)::bigint
from public.domain_orders
where status in ('paid','processing') and paid_at is not null and updated_at < now() - interval '30 minutes'
union all
select 'stale_dns_records', count(*)::bigint
from public.domain_dns_records
where status in ('pending','deleting','failed') and updated_at < now() - interval '30 minutes'
union all
select 'tlds_with_failed_provider_sync', count(*)::bigint
from public.domain_tld_prices
where provider_available = true and (registration_sync_status = 'failed' or renewal_sync_status = 'failed' or transfer_sync_status = 'failed')
union all
select 'tlds_without_registration_cost', count(*)::bigint
from public.domain_tld_prices
where enabled = true and provider_available = true and coalesce(registration_cost_usd, 0) <= 0
union all
select 'tlds_without_renewal_cost', count(*)::bigint
from public.domain_tld_prices
where enabled = true and provider_available = true and coalesce(renewal_cost_usd, 0) <= 0
union all
select 'tlds_without_transfer_cost', count(*)::bigint
from public.domain_tld_prices
where enabled = true and provider_available = true and transfer_sync_status = 'synced' and coalesce(transfer_cost_usd, 0) <= 0
union all
select 'expired_provider_quotes', count(*)::bigint
from public.domain_provider_quotes
where expires_at < now() and created_at > now() - interval '1 day';

revoke all on public.domain_operational_issues from public, anon, authenticated;

grant select, insert, update, delete on public.domain_forwarding_rules to service_role;
grant select, insert, update, delete on public.domain_glue_hosts to service_role;
grant select, insert, update, delete on public.domain_provider_quotes to service_role;

alter table public.domain_provider_quotes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='domain_provider_quotes' and policyname='deny_direct_client_access') then
    create policy deny_direct_client_access on public.domain_provider_quotes for all to anon, authenticated using (false) with check (false);
  end if;
end $$;

create or replace function public.domain_invoke_order_poller()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net, pg_temp
as $$
declare
  request_id bigint;
  supabase_url text := 'https://igihzeyfgwhnuiflamvn.supabase.co';
  cron_secret text;
begin
  cron_secret := public.domain_secret('domain_internal_cron_secret');
  select net.http_post(
    url := supabase_url || '/functions/v1/domain-order-poller?limit=20',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-domain-cron-secret', cron_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.domain_invoke_order_poller() from public, anon, authenticated;
grant execute on function public.domain_invoke_order_poller() to postgres, service_role;

select cron.unschedule('domain-order-poller') where exists (select 1 from cron.job where jobname='domain-order-poller');
select cron.schedule('domain-order-poller', '*/5 * * * *', $$select public.domain_invoke_order_poller();$$);
