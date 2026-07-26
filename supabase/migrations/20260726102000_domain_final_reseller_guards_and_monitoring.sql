alter table public.domain_config
  add column if not exists provider_low_balance_threshold_usd numeric(12,2) not null default 25,
  add column if not exists checkout_pause_message text not null default 'Domain purchases are paused while provider or payment setup is in test mode.';

alter table public.domain_provider_quotes
  add column if not exists provider_exact_cost_usd numeric(12,2),
  add column if not exists premium_detected boolean not null default false,
  add column if not exists provider_balance_usd numeric(12,2),
  add column if not exists provider_balance_verified_at timestamptz;

create or replace view public.domain_admin_cron_status
with (security_invoker = true)
as
select
  j.jobname,
  j.schedule,
  j.active,
  max(r.started_at) as last_started_at,
  max(r.finished_at) as last_finished_at,
  (array_agg(r.status order by r.started_at desc))[1] as last_status,
  (array_agg(r.duration_ms order by r.started_at desc))[1] as last_duration_ms,
  (array_agg(r.error_message order by r.started_at desc))[1] as last_error_message
from cron.job j
left join public.domain_cron_runs r on r.job_name = j.jobname
where j.jobname like 'domain-%'
group by j.jobname, j.schedule, j.active;

revoke all on public.domain_admin_cron_status from public, anon, authenticated;
grant select on public.domain_admin_cron_status to service_role;

create index if not exists domain_notifications_user_unread_idx on public.domain_notifications(user_id, read_at) where read_at is null;
create index if not exists domain_provider_quotes_expiry_idx on public.domain_provider_quotes(expires_at);

create or replace view public.domain_operational_issues
with (security_invoker = true)
as
select 'active_failed_jobs'::text as issue, count(*)::bigint as count
from public.domain_jobs
where status in ('failed','running') and archived_at is null
union all
select 'orders_processing_over_30_min', count(*)::bigint
from public.domain_orders
where status = 'processing' and updated_at < now() - interval '30 minutes'
union all
select 'paid_cancelled_or_failed_orders_needing_refund', count(*)::bigint
from public.domain_orders o
where o.status in ('cancelled','failed') and o.paid_at is not null
  and not exists (
    select 1 from public.domain_wallet_transactions t
    where t.user_id = o.user_id
      and t.transaction_type = 'refund_credit'
      and (t.metadata->>'orderId')::uuid = o.id
  )
union all
select 'paid_orders_not_completed_or_failed_over_30_min', count(*)::bigint
from public.domain_orders
where status in ('paid','processing') and paid_at is not null and updated_at < now() - interval '30 minutes'
union all
select 'stale_dns_records', count(*)::bigint
from public.domain_dns_records
where status in ('pending','deleting','failed') and updated_at < now() - interval '30 minutes'
union all
select 'tlds_with_failed_provider_sync', count(*)::bigint
from public.domain_tld_prices
where provider_available = true and (registration_sync_status = 'failed' or renewal_sync_status = 'failed' or transfer_sync_status = 'failed')
union all
select 'tlds_without_registration_cost', count(*)::bigint
from public.domain_tld_prices
where enabled = true and provider_available = true and coalesce(registration_cost_usd, 0) <= 0
union all
select 'tlds_without_renewal_cost', count(*)::bigint
from public.domain_tld_prices
where enabled = true and provider_available = true and coalesce(renewal_cost_usd, 0) <= 0
union all
select 'tlds_without_transfer_cost', count(*)::bigint
from public.domain_tld_prices
where enabled = true and provider_available = true and transfer_sync_status = 'synced' and coalesce(transfer_cost_usd, 0) <= 0
union all
select 'expired_provider_quotes', count(*)::bigint
from public.domain_provider_quotes
where expires_at < now() and created_at > now() - interval '1 day'
union all
select 'failed_cron_runs_24h', count(*)::bigint
from public.domain_cron_runs
where status = 'error' and started_at > now() - interval '24 hours';

revoke all on public.domain_operational_issues from public, anon, authenticated;
