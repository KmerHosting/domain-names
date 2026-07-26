alter table public.domain_tld_prices
  add column if not exists provider_available boolean not null default false,
  add column if not exists provider_product_name text,
  add column if not exists provider_catalog_seen_at timestamptz,
  add column if not exists provider_catalog_payload jsonb;

create index if not exists domain_tld_prices_provider_available_idx
  on public.domain_tld_prices(provider_available, tld);

update public.domain_tld_prices
set provider_available = true
where last_synced_at is not null
   or price_source in ('provider_sync','provider_product_info','cost_plus_margin');

create or replace function public.domain_catalog_price(p_payload jsonb, p_kind text)
returns numeric
language sql
stable
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
    order by case when (price.value->>'period')::int = 1 then 0 else 1 end,
             (price.value->>'period')::int nulls last
    limit 1
  )
  select price from selected_price;
$$;

update public.domain_tld_prices
set transfer_cost_usd = null,
    transfer_price_usd = 0,
    transfer_sync_status = 'unsupported',
    updated_at = now()
where provider_available = true
  and provider_catalog_payload is not null
  and public.domain_catalog_price(provider_catalog_payload, 'transfer') is null;

update public.domain_tld_prices
set registration_cost_usd = coalesce(public.domain_catalog_price(provider_catalog_payload, 'register'), registration_cost_usd),
    renewal_cost_usd = coalesce(public.domain_catalog_price(provider_catalog_payload, 'renew'), renewal_cost_usd),
    transfer_cost_usd = coalesce(public.domain_catalog_price(provider_catalog_payload, 'transfer'), transfer_cost_usd),
    registration_price_usd = coalesce(round(public.domain_catalog_price(provider_catalog_payload, 'register') * 1.30, 2), registration_price_usd),
    renewal_price_usd = coalesce(round(public.domain_catalog_price(provider_catalog_payload, 'renew') * 1.30, 2), renewal_price_usd),
    transfer_price_usd = coalesce(round(public.domain_catalog_price(provider_catalog_payload, 'transfer') * 1.30, 2), transfer_price_usd),
    registration_sync_status = case when public.domain_catalog_price(provider_catalog_payload, 'register') is not null then 'synced' else registration_sync_status end,
    renewal_sync_status = case when public.domain_catalog_price(provider_catalog_payload, 'renew') is not null then 'synced' else renewal_sync_status end,
    transfer_sync_status = case when public.domain_catalog_price(provider_catalog_payload, 'transfer') is not null then 'synced' else transfer_sync_status end,
    price_source = 'provider_catalog',
    last_synced_at = now(),
    updated_at = now()
where provider_available = true
  and provider_catalog_payload is not null;

update public.domain_tld_prices
set enabled = false, updated_at = now()
where provider_available = false;