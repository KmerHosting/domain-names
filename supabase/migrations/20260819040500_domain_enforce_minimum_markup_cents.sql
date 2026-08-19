-- Keep catalog prices and the order guard consistent at USD cent precision.
-- A 30% markup is rounded upward to the next cent so it never falls below
-- the configured minimum after currency rounding.

create or replace function public.domain_enforce_period_price_minimum_markup()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.provider_cost_usd is not null and new.provider_cost_usd > 0 then
    new.customer_price_usd := greatest(
      coalesce(new.customer_price_usd, 0),
      ceil(new.provider_cost_usd * 1.30 * 100) / 100
    );
  end if;
  return new;
end;
$$;

revoke all on function public.domain_enforce_period_price_minimum_markup() from public, anon, authenticated;

drop trigger if exists domain_tld_period_prices_minimum_markup on public.domain_tld_period_prices;
create trigger domain_tld_period_prices_minimum_markup
before insert or update of provider_cost_usd, customer_price_usd
on public.domain_tld_period_prices
for each row
execute function public.domain_enforce_period_price_minimum_markup();

create or replace function public.domain_enforce_tld_price_minimum_markup()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.registration_cost_usd is not null and new.registration_cost_usd > 0 then
    new.registration_price_usd := greatest(coalesce(new.registration_price_usd, 0), ceil(new.registration_cost_usd * 1.30 * 100) / 100);
  end if;
  if new.renewal_cost_usd is not null and new.renewal_cost_usd > 0 then
    new.renewal_price_usd := greatest(coalesce(new.renewal_price_usd, 0), ceil(new.renewal_cost_usd * 1.30 * 100) / 100);
  end if;
  if new.transfer_cost_usd is not null and new.transfer_cost_usd > 0 then
    new.transfer_price_usd := greatest(coalesce(new.transfer_price_usd, 0), ceil(new.transfer_cost_usd * 1.30 * 100) / 100);
  end if;
  if new.restore_cost_usd is not null and new.restore_cost_usd > 0 then
    new.restore_price_usd := greatest(coalesce(new.restore_price_usd, 0), ceil(new.restore_cost_usd * 1.30 * 100) / 100);
  end if;
  return new;
end;
$$;

revoke all on function public.domain_enforce_tld_price_minimum_markup() from public, anon, authenticated;

drop trigger if exists domain_tld_prices_minimum_markup on public.domain_tld_prices;
create trigger domain_tld_prices_minimum_markup
before insert or update of registration_cost_usd, registration_price_usd, renewal_cost_usd, renewal_price_usd, transfer_cost_usd, transfer_price_usd, restore_cost_usd, restore_price_usd
on public.domain_tld_prices
for each row
execute function public.domain_enforce_tld_price_minimum_markup();

update public.domain_tld_period_prices
set customer_price_usd = ceil(provider_cost_usd * 1.30 * 100) / 100
where provider_cost_usd > 0
  and customer_price_usd < ceil(provider_cost_usd * 1.30 * 100) / 100;

update public.domain_tld_prices
set
  registration_price_usd = case when registration_cost_usd > 0 then greatest(coalesce(registration_price_usd, 0), ceil(registration_cost_usd * 1.30 * 100) / 100) else registration_price_usd end,
  renewal_price_usd = case when renewal_cost_usd > 0 then greatest(coalesce(renewal_price_usd, 0), ceil(renewal_cost_usd * 1.30 * 100) / 100) else renewal_price_usd end,
  transfer_price_usd = case when transfer_cost_usd > 0 then greatest(coalesce(transfer_price_usd, 0), ceil(transfer_cost_usd * 1.30 * 100) / 100) else transfer_price_usd end,
  restore_price_usd = case when restore_cost_usd > 0 then greatest(coalesce(restore_price_usd, 0), ceil(restore_cost_usd * 1.30 * 100) / 100) else restore_price_usd end,
  updated_at = now()
where
  (registration_cost_usd > 0 and registration_price_usd < ceil(registration_cost_usd * 1.30 * 100) / 100)
  or (renewal_cost_usd > 0 and renewal_price_usd < ceil(renewal_cost_usd * 1.30 * 100) / 100)
  or (transfer_cost_usd > 0 and transfer_price_usd < ceil(transfer_cost_usd * 1.30 * 100) / 100)
  or (restore_cost_usd > 0 and restore_price_usd < ceil(restore_cost_usd * 1.30 * 100) / 100);
