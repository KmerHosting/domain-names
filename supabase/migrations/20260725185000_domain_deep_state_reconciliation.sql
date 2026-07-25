alter table public.domain_jobs
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

create index if not exists idx_domain_jobs_active_status_run_after
  on public.domain_jobs(status, run_after)
  where archived_at is null;

create or replace function public.domain_refund_order_to_wallet(p_order_id uuid, p_reason text default 'Order could not be completed.')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.domain_orders%rowtype;
  v_user_balance numeric;
  v_existing uuid;
  v_tx_id uuid;
  v_new_balance numeric;
begin
  select * into v_order from public.domain_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'order_not_found'); end if;
  if v_order.paid_at is null or v_order.price_usd <= 0 then return jsonb_build_object('ok', false, 'reason', 'order_not_paid'); end if;

  select id into v_existing from public.domain_wallet_transactions where idempotency_key = 'order-refund:' || v_order.id::text;
  if v_existing is not null then
    update public.domain_orders set status = 'refunded', failure_code = coalesce(failure_code, 'refunded_to_balance'), failure_message = coalesce(nullif(failure_message, ''), p_reason), updated_at = now() where id = v_order.id;
    return jsonb_build_object('ok', true, 'alreadyRefunded', true, 'transactionId', v_existing);
  end if;

  select balance_usd into v_user_balance from public.domain_users where id = v_order.user_id for update;
  if v_user_balance is null then return jsonb_build_object('ok', false, 'reason', 'user_not_found'); end if;
  v_new_balance := v_user_balance + v_order.price_usd;

  update public.domain_users set balance_usd = v_new_balance, updated_at = now() where id = v_order.user_id;
  insert into public.domain_wallet_transactions(user_id, transaction_type, amount_usd, balance_after_usd, reference, idempotency_key, metadata)
  values (v_order.user_id, 'refund_credit', v_order.price_usd, v_new_balance, v_order.order_number, 'order-refund:' || v_order.id::text, jsonb_build_object('orderId', v_order.id, 'domainName', v_order.domain_name, 'reason', p_reason))
  returning id into v_tx_id;

  update public.domain_orders set status = 'refunded', failure_code = 'refunded_to_balance', failure_message = p_reason, updated_at = now() where id = v_order.id;
  insert into public.domain_notifications(user_id, type, title, message, data)
  values (v_order.user_id, 'billing', 'Order refunded to balance', 'We could not complete ' || v_order.domain_name || '. The amount has been credited to your account balance.', jsonb_build_object('orderId', v_order.id, 'transactionId', v_tx_id));

  return jsonb_build_object('ok', true, 'transactionId', v_tx_id, 'balanceAfterUsd', v_new_balance);
end;
$$;

revoke all on function public.domain_refund_order_to_wallet(uuid,text) from public, anon, authenticated;
grant execute on function public.domain_refund_order_to_wallet(uuid,text) to service_role;

create or replace function public.domain_cleanup_stale_operational_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_dns integer := 0;
  v_archived_jobs integer := 0;
  v_archived_terminal_jobs integer := 0;
  v_refunded_orders integer := 0;
  v_order record;
  v_result jsonb;
begin
  delete from public.domain_dns_records where status in ('failed', 'deleting') and updated_at < now() - interval '2 minutes';
  get diagnostics v_deleted_dns = row_count;

  for v_order in
    select * from public.domain_orders
    where paid_at is not null
      and status in ('paid', 'processing', 'failed', 'cancelled')
      and ((type = 'transfer' and years <> 1) or (status in ('cancelled', 'failed') and completed_at is null))
  loop
    v_result := public.domain_refund_order_to_wallet(
      v_order.id,
      case
        when v_order.type = 'transfer' and v_order.years <> 1 then 'Transfer could not be completed because the provider only accepted a one-year transfer period. Refunded to account balance.'
        else 'Order could not be completed. Refunded to account balance.'
      end
    );
    if coalesce((v_result->>'ok')::boolean, false) then v_refunded_orders := v_refunded_orders + 1; end if;
  end loop;

  update public.domain_jobs set archived_at = now(), archive_reason = coalesce(archive_reason, 'historical terminal state after reconciliation'), updated_at = now()
  where archived_at is null and status in ('dead', 'completed') and updated_at < now() - interval '30 minutes';
  get diagnostics v_archived_jobs = row_count;

  update public.domain_jobs j set archived_at = now(), archive_reason = coalesce(archive_reason, 'order reached terminal/refunded state'), updated_at = now()
  from public.domain_orders o
  where j.order_id = o.id and j.archived_at is null and o.status in ('cancelled', 'refunded', 'completed') and j.status in ('failed', 'dead', 'completed');
  get diagnostics v_archived_terminal_jobs = row_count;

  return jsonb_build_object('deletedDns', v_deleted_dns, 'archivedJobs', v_archived_jobs, 'archivedTerminalJobs', v_archived_terminal_jobs, 'refundedOrders', v_refunded_orders);
end;
$$;

revoke all on function public.domain_cleanup_stale_operational_state() from public, anon, authenticated;
grant execute on function public.domain_cleanup_stale_operational_state() to service_role;

drop view if exists public.domain_operational_issues;
create view public.domain_operational_issues as
select 'active_failed_jobs'::text as issue, count(*)::bigint as count from public.domain_jobs where status in ('failed', 'dead') and archived_at is null
union all select 'stale_dns_records'::text as issue, count(*)::bigint as count from public.domain_dns_records where status in ('failed', 'deleting') and updated_at < now() - interval '2 minutes'
union all select 'orders_processing_over_30_min'::text as issue, count(*)::bigint as count from public.domain_orders where status = 'processing' and updated_at < now() - interval '30 minutes'
union all select 'paid_orders_not_completed_or_failed_over_30_min'::text as issue, count(*)::bigint as count from public.domain_orders where status in ('paid', 'processing') and paid_at < now() - interval '30 minutes'
union all select 'paid_cancelled_or_failed_orders_needing_refund'::text as issue, count(*)::bigint as count from public.domain_orders o where o.paid_at is not null and o.status in ('cancelled', 'failed') and not exists (select 1 from public.domain_wallet_transactions wt where wt.idempotency_key = 'order-refund:' || o.id::text)
union all select 'tlds_without_provider_cost'::text as issue, count(*)::bigint as count from public.domain_tld_prices where enabled = true and registration_cost_usd is null;

select public.domain_cleanup_stale_operational_state();