do $body$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'domain_domains_no_simulated_provider_id'
      and conrelid = 'public.domain_domains'::regclass
  ) then
    alter table public.domain_domains
      add constraint domain_domains_no_simulated_provider_id
      check (
        coalesce(registrar_domain_id, '') !~* '^OTE-SIM-'
        and lower(coalesce(metadata ->> 'simulatedOte', 'false')) not in ('true', '1', 'yes')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'domain_orders_no_simulated_provider_id'
      and conrelid = 'public.domain_orders'::regclass
  ) then
    alter table public.domain_orders
      add constraint domain_orders_no_simulated_provider_id
      check (coalesce(registrar_order_id, '') !~* '^OTE-SIM-');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'domain_provider_quotes_no_simulation'
      and conrelid = 'public.domain_provider_quotes'::regclass
  ) then
    alter table public.domain_provider_quotes
      add constraint domain_provider_quotes_no_simulation
      check (upper(coalesce(provider_payload ->> 'code', '')) <> 'OTE_SEARCH_SIMULATED');
  end if;

  begin
    perform cron.unschedule('domain-dns-auto-sync');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'domain-dns-auto-sync',
    '7 * * * *',
    $cron$select public.domain_recorded_cron('domain-dns-auto-sync', 'select public.domain_invoke_dns_auto_sync();');$cron$
  );
end
$body$;

revoke all on function public.domain_invoke_dns_auto_sync() from public;
revoke all on function public.domain_invoke_dns_auto_sync() from anon;
revoke all on function public.domain_invoke_dns_auto_sync() from authenticated;

comment on constraint domain_domains_no_simulated_provider_id on public.domain_domains
  is 'Defense in depth: customer domains must reference real DomainNameAPI objects.';
comment on constraint domain_provider_quotes_no_simulation on public.domain_provider_quotes
  is 'Defense in depth: simulated OTE availability cannot be persisted.';
