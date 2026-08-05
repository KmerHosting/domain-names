create index if not exists domain_orders_provider_quote_id_idx
  on public.domain_orders(provider_quote_id)
  where provider_quote_id is not null;

create index if not exists domain_provider_quotes_order_id_idx
  on public.domain_provider_quotes(order_id)
  where order_id is not null;

drop index if exists public.idx_domain_forwarding_user;
drop index if exists public.idx_domain_glue_user;
drop index if exists public.domain_glue_hosts_domain_host_idx;

do $body$
begin
  begin
    perform cron.unschedule('domain-dns-auto-sync');
  exception when others then
    null;
  end;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'domain_recorded_http_cron'
  ) then
    perform cron.schedule(
      'domain-dns-auto-sync',
      '17 */6 * * *',
      $cron$select public.domain_recorded_http_cron('domain-dns-auto-sync', 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-dns-auto-sync/run', '{}'::jsonb);$cron$
    );
  end if;
end
$body$;

comment on index public.domain_orders_provider_quote_id_idx is 'Covers domain_orders.provider_quote_id foreign key for provider quote lookups.';
comment on index public.domain_provider_quotes_order_id_idx is 'Covers domain_provider_quotes.order_id foreign key for order quote lookups.';