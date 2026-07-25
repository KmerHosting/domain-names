create or replace function public.domain_invoke_jobs()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'domain_internal_cron_secret'
  limit 1;

  if v_secret is null or length(v_secret) < 20 then
    raise exception 'domain_internal_cron_secret is not configured';
  end if;

  select net.http_post(
    url := 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-api/internal/jobs',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Accept', 'application/json',
      'x-domain-cron-secret', v_secret
    ),
    timeout_milliseconds := 50000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.domain_invoke_jobs() from public, anon, authenticated;
grant execute on function public.domain_invoke_jobs() to postgres, service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'domain-payment-polling';

select cron.schedule(
  'domain-payment-polling',
  '* * * * *',
  'select public.domain_invoke_jobs();'
);
