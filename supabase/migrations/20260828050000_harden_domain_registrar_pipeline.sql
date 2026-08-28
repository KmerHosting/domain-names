-- Prevent two payable registrar operations from running concurrently for the same domain.
create unique index if not exists domain_orders_one_inflight_per_domain_uidx
  on public.domain_orders (lower(domain_name), registrar_environment)
  where status in ('paid', 'queued', 'processing');

-- DomainNameAPI DNS mutations operate on a complete record set keyed by (name, type).
update public.domain_dns_records
set record_key = lower(coalesce(nullif(btrim(name), ''), '@')) || '::' || upper(type),
    updated_at = now()
where record_key is distinct from lower(coalesce(nullif(btrim(name), ''), '@')) || '::' || upper(type);

drop index if exists public.domain_dns_records_domain_record_key_uidx;
create unique index domain_dns_records_domain_record_key_uidx
  on public.domain_dns_records (domain_id, record_key)
  where record_key is not null and status <> 'deleting';

-- Reconcile historical OTE rows that have no registrar job and were confirmed absent at the provider.
update public.domain_orders
set status = 'failed',
    failure_code = 'legacy_ote_orphan_reconciled',
    failure_message = 'Historical OTE order had no registrar job and no registered provider domain; reconciled during the registrar pipeline audit.',
    updated_at = now()
where id in (
  'f4f5ed1a-e13e-4c8d-a8a3-8a079a463b4d'::uuid,
  'f3f7d2d6-7aa0-4f54-aadd-2e7350dee2ad'::uuid
)
and registrar_environment = 'ote'
and status = 'processing'
and registrar_order_id is null
and not exists (
  select 1 from public.domain_jobs j where j.order_id = public.domain_orders.id
);
