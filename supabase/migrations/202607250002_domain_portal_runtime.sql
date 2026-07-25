-- Create server-generated Vault secrets if they do not already exist.
do $$
begin
  if not exists(select 1 from vault.secrets where name='domain_internal_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'domain_internal_cron_secret','Internal authorization secret for domain automation');
  end if;
  if not exists(select 1 from vault.secrets where name='domain_data_encryption_key') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'domain_data_encryption_key','Encryption key material for transfer auth codes');
  end if;
end $$;

-- Add Mailtrap, CamerPay and DomainNameAPI secrets through Supabase Vault before enabling production.

create or replace function public.domain_invoke_automation()
returns bigint
language plpgsql
security definer
set search_path=public,vault,net,pg_temp
as $$
declare v_secret text; v_request_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets
  where name='domain_internal_cron_secret' limit 1;
  if v_secret is null or length(v_secret)<20 then
    raise exception 'domain_internal_cron_secret is not configured';
  end if;
  select net.http_post(
    url := 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-api/automation',
    body := '{}',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Accept','application/json',
      'x-domain-cron-secret',v_secret
    ),
    timeout_milliseconds := 50000
  ) into v_request_id;
  return v_request_id;
end $$;
revoke all on function public.domain_invoke_automation() from public,anon,authenticated;
grant execute on function public.domain_invoke_automation() to service_role;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='domain-portal-automation';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule('domain-portal-automation','*/5 * * * *','select public.domain_invoke_automation();');
end $$;
