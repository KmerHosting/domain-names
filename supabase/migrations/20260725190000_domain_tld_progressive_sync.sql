alter table public.domain_tld_prices
  add column if not exists provider_sync_attempts integer not null default 0,
  add column if not exists provider_next_sync_at timestamptz not null default now(),
  add column if not exists provider_sync_error text;

create index if not exists idx_domain_tld_prices_sync_queue
  on public.domain_tld_prices(provider_next_sync_at, provider_sync_attempts)
  where enabled = true and registration_cost_usd is null;

create or replace function public.domain_invoke_tld_sync_worker()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_request_id bigint;
begin
  select net.http_post(
    url := 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-tld-sync-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-domain-cron-secret', public.domain_secret('domain_internal_cron_secret')
    ),
    body := jsonb_build_object('limit', 1, 'marginPercent', 30),
    timeout_milliseconds := 30000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.domain_invoke_tld_sync_worker() from public, anon, authenticated;
grant execute on function public.domain_invoke_tld_sync_worker() to service_role;

select cron.unschedule('domain-tld-progressive-sync') where exists (select 1 from cron.job where jobname='domain-tld-progressive-sync');
select cron.schedule('domain-tld-progressive-sync', '*/2 * * * *', 'select public.domain_invoke_tld_sync_worker();');