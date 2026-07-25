-- Prevent the legacy domain-api automation endpoint from running the old registrar worker.
-- The cron job keeps its historical name, but now calls the new automation worker.
create or replace function public.domain_invoke_automation()
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
    url := 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-automation-v2',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Accept','application/json',
      'x-domain-cron-secret', v_secret
    ),
    timeout_milliseconds := 50000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.domain_invoke_automation() from public, anon, authenticated;
grant execute on function public.domain_invoke_automation() to service_role, postgres;

update public.domain_jobs
set status = 'dead',
    locked_at = null,
    locked_by = null,
    last_error = coalesce(nullif(last_error, ''), 'Job reached max attempts without a final status.'),
    updated_at = now()
where status in ('pending','running','failed')
  and attempts >= max_attempts
  and completed_at is null;

update public.domain_dns_records r
set status = 'failed',
    registrar_response = coalesce(r.registrar_response, '{}'::jsonb) || jsonb_build_object(
      'error', 'provider_dns_operation_failed_or_exhausted',
      'message', coalesce(nullif(j.last_error, ''), 'DomainNameAPI DNS Zone API rejected or did not complete the operation.')
    ),
    updated_at = now()
from public.domain_jobs j
where j.domain_id = r.domain_id
  and j.type in ('create_dns_record','update_dns_record','delete_dns_record')
  and j.status in ('dead','failed')
  and j.attempts >= j.max_attempts
  and r.status in ('pending','deleting');

update public.domain_jobs
set status = 'dead',
    locked_at = null,
    locked_by = null,
    last_error = coalesce(nullif(last_error, ''), 'Payment polling job reached max attempts; manual check remains available.'),
    updated_at = now()
where type = 'check_payment'
  and status in ('pending','running','failed')
  and attempts >= max_attempts
  and completed_at is null;

create or replace view public.domain_operational_issues as
select 'dead_jobs'::text as issue, count(*)::bigint as count
from public.domain_jobs
where status = 'dead'
union all
select 'failed_dns_records', count(*)::bigint
from public.domain_dns_records
where status = 'failed'
union all
select 'orders_processing_over_30_min', count(*)::bigint
from public.domain_orders
where status = 'processing'
  and updated_at < now() - interval '30 minutes'
union all
select 'paid_orders_not_completed_or_failed_over_30_min', count(*)::bigint
from public.domain_orders
where status in ('paid','processing')
  and paid_at < now() - interval '30 minutes';

revoke all on public.domain_operational_issues from public, anon, authenticated;
