alter table public.domain_dns_records
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists source text not null default 'local',
  add column if not exists provider_record_id text,
  add column if not exists record_key text,
  add column if not exists last_operation text,
  add column if not exists last_error text,
  add column if not exists synced_at timestamptz;

alter table public.domain_dns_records
  add constraint domain_dns_records_source_check
  check (source in ('local','provider','imported','manual')) not valid;

alter table public.domain_dns_records
  add constraint domain_dns_records_last_operation_check
  check (last_operation is null or last_operation in ('create','update','delete','sync','retry')) not valid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'domain_dns_records_type_check'
      and conrelid = 'public.domain_dns_records'::regclass
  ) then
    alter table public.domain_dns_records
      add constraint domain_dns_records_type_check
      check (type in ('A','AAAA','CNAME','MX','TXT','NS','SRV','CAA')) not valid;
  end if;
end $$;

update public.domain_dns_records
set record_key = lower(coalesce(name,'@')) || ':' || upper(type) || ':' || md5(array_to_string(contents, '||') || ':' || coalesce(priority::text, '') || ':' || coalesce(metadata::text, '{}')),
    source = case when registrar_response <> '{}'::jsonb then 'provider' else source end,
    synced_at = coalesce(synced_at, updated_at)
where record_key is null;

create unique index if not exists domain_dns_records_domain_record_key_uidx
  on public.domain_dns_records(domain_id, record_key)
  where record_key is not null;

create index if not exists domain_dns_records_domain_status_idx
  on public.domain_dns_records(domain_id, status, updated_at desc);

create index if not exists domain_dns_records_environment_idx
  on public.domain_dns_records(registrar_environment, status);

create or replace view public.domain_dns_records_with_environment as
select
  r.*,
  d.domain_name,
  d.nameservers as domain_nameservers,
  d.registrar_environment as domain_registrar_environment,
  (r.registrar_environment = public.domain_current_registrar_environment()) as environment_is_current,
  case when r.registrar_environment = 'ote' then 'TEST' else 'LIVE' end as registrar_environment_label
from public.domain_dns_records r
join public.domain_domains d on d.id = r.domain_id;

grant select on public.domain_dns_records_with_environment to authenticated, anon;

comment on view public.domain_dns_records_with_environment is 'DNS records with local registrar environment marker and domain nameserver context.';
