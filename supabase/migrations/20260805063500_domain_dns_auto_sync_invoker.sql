create or replace function public.domain_invoke_dns_auto_sync()
returns bigint
language plpgsql
security definer
set search_path to 'public','extensions','net','pg_temp'
as $function$
declare
  v_request_id bigint;
begin
  select net.http_post(
    url := 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-dns-auto-sync/run',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-domain-cron-secret', public.domain_secret('domain_internal_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_request_id;
  return v_request_id;
end;
$function$;

revoke all on function public.domain_invoke_dns_auto_sync() from public;
revoke all on function public.domain_invoke_dns_auto_sync() from anon;
revoke all on function public.domain_invoke_dns_auto_sync() from authenticated;

do $body$
begin
  begin
    perform cron.unschedule('domain-dns-auto-sync');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'domain-dns-auto-sync',
    '17 */6 * * *',
    $cron$select public.domain_recorded_cron('domain-dns-auto-sync', 'select public.domain_invoke_dns_auto_sync();');$cron$
  );
end
$body$;

comment on function public.domain_invoke_dns_auto_sync() is 'Invokes the read-only DomainNameAPI DNS sync worker through the internal cron secret. Public execution is revoked.';