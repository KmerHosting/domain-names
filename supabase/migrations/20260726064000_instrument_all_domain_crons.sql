create or replace function public.domain_recorded_cron(p_job_name text, p_sql text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net, cron, pg_temp
as $$
declare
  v_run_id uuid;
  v_started timestamptz := now();
  v_result bigint := null;
begin
  insert into public.domain_cron_runs(job_name, status, started_at, details)
  values (p_job_name, 'running', v_started, jsonb_build_object('sql', p_sql))
  returning id into v_run_id;

  execute p_sql into v_result;

  update public.domain_cron_runs
  set status = 'success',
      finished_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - v_started)) * 1000)::int),
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('request_id', v_result)
  where id = v_run_id;

  return v_result;
exception when others then
  update public.domain_cron_runs
  set status = 'failed',
      finished_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - v_started)) * 1000)::int),
      error_message = sqlerrm,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('sqlstate', sqlstate)
  where id = v_run_id;
  raise;
end;
$$;

create or replace function public.domain_recorded_transfer_worker()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net, cron, pg_temp
as $$
declare
  v_run_id uuid;
  v_started timestamptz := now();
  v_request_id bigint;
begin
  insert into public.domain_cron_runs(job_name, status, started_at, details)
  values ('domain-transfer-worker', 'running', v_started, jsonb_build_object('function', 'domain-transfer-worker'))
  returning id into v_run_id;

  select net.http_post(
    url := 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-transfer-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-domain-cron-secret', public.domain_secret('domain_internal_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_request_id;

  update public.domain_cron_runs
  set status = 'success',
      finished_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - v_started)) * 1000)::int),
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('request_id', v_request_id)
  where id = v_run_id;

  return v_request_id;
exception when others then
  update public.domain_cron_runs
  set status = 'failed',
      finished_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - v_started)) * 1000)::int),
      error_message = sqlerrm,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('sqlstate', sqlstate)
  where id = v_run_id;
  raise;
end;
$$;

revoke all on function public.domain_recorded_cron(text,text) from public, anon, authenticated;
revoke all on function public.domain_recorded_transfer_worker() from public, anon, authenticated;
grant execute on function public.domain_recorded_cron(text,text) to postgres, service_role;
grant execute on function public.domain_recorded_transfer_worker() to postgres, service_role;

select cron.unschedule('domain-jobs-v2') where exists (select 1 from cron.job where jobname='domain-jobs-v2');
select cron.schedule('domain-jobs-v2', '* * * * *', $$select public.domain_recorded_cron('domain-jobs-v2', 'select public.domain_invoke_jobs_v2();');$$);

select cron.unschedule('domain-payment-polling') where exists (select 1 from cron.job where jobname='domain-payment-polling');
select cron.schedule('domain-payment-polling', '* * * * *', $$select public.domain_recorded_cron('domain-payment-polling', 'select public.domain_invoke_payment_polling();');$$);

select cron.unschedule('domain-portal-automation') where exists (select 1 from cron.job where jobname='domain-portal-automation');
select cron.schedule('domain-portal-automation', '*/5 * * * *', $$select public.domain_recorded_cron('domain-portal-automation', 'select public.domain_invoke_automation();');$$);

select cron.unschedule('domain-tld-progressive-sync') where exists (select 1 from cron.job where jobname='domain-tld-progressive-sync');
select cron.schedule('domain-tld-progressive-sync', '*/2 * * * *', $$select public.domain_recorded_cron('domain-tld-progressive-sync', 'select public.domain_invoke_tld_sync_worker();');$$);

select cron.unschedule('domain-transfer-worker') where exists (select 1 from cron.job where jobname='domain-transfer-worker');
select cron.schedule('domain-transfer-worker', '* * * * *', $$select public.domain_recorded_transfer_worker();$$);

select cron.unschedule('domain-wallet-polling') where exists (select 1 from cron.job where jobname='domain-wallet-polling');
select cron.schedule('domain-wallet-polling', '* * * * *', $$select public.domain_recorded_cron('domain-wallet-polling', 'select public.domain_invoke_wallet_polling();');$$);

select cron.unschedule('domain-order-poller') where exists (select 1 from cron.job where jobname='domain-order-poller');
select cron.schedule('domain-order-poller', '*/5 * * * *', $$select public.domain_recorded_cron('domain-order-poller', 'select public.domain_invoke_order_poller();');$$);
