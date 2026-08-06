begin;

alter table public.domain_config
  add column if not exists payment_mode text not null default 'wallet_only',
  add column if not exists wallet_topup_mode text not null default 'manual_support';

update public.domain_config
set registrar_environment = 'production',
    payment_sandbox = false,
    maintenance_mode = false,
    payment_mode = 'wallet_only',
    wallet_topup_mode = 'manual_support',
    checkout_pause_message = 'Domain ordering is temporarily unavailable during maintenance. Contact support@kmerhosting.com for assistance.',
    updated_at = now()
where id = true;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'domain-payment-polling') then
    perform cron.unschedule('domain-payment-polling');
  end if;
  if exists (select 1 from cron.job where jobname = 'domain-wallet-polling') then
    perform cron.unschedule('domain-wallet-polling');
  end if;
end $$;

drop function if exists public.domain_invoke_payment_polling();
drop function if exists public.domain_invoke_wallet_polling();
drop function if exists public.domain_finalize_paid_payment(uuid, text, text, numeric, jsonb);
drop function if exists public.domain_wallet_credit_topup(uuid, jsonb);

alter table public.domain_payments alter column provider set default 'wallet';
alter table public.domain_wallet_topups alter column provider set default 'manual_support';

create or replace function public.domain_manual_wallet_credit(
  p_admin_id uuid,
  p_user_id uuid,
  p_amount_usd numeric,
  p_reason text default 'Manual support credit',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.domain_users%rowtype;
  v_user public.domain_users%rowtype;
  v_amount numeric(12,2);
  v_new_balance numeric(12,2);
  v_key text;
  v_reference text;
  v_transaction_id uuid;
  v_existing public.domain_wallet_transactions%rowtype;
begin
  select * into v_admin
  from public.domain_users
  where id = p_admin_id and role = 'admin' and status = 'active';

  if not found then
    raise exception 'admin_required';
  end if;

  v_amount := round(coalesce(p_amount_usd, 0)::numeric, 2);
  if v_amount <= 0 or v_amount > 100000 then
    raise exception 'invalid_credit_amount';
  end if;

  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    v_key := 'manual-support-credit:' || p_user_id::text || ':' || md5(clock_timestamp()::text || random()::text);
  end if;

  select * into v_existing
  from public.domain_wallet_transactions
  where idempotency_key = v_key
  limit 1;

  if found then
    return jsonb_build_object(
      'credited', false,
      'alreadyCredited', true,
      'transactionId', v_existing.id,
      'balanceUsd', v_existing.balance_after_usd
    );
  end if;

  select * into v_user
  from public.domain_users
  where id = p_user_id and status <> 'deleted'
  for update;

  if not found then
    raise exception 'wallet_user_not_found';
  end if;

  v_new_balance := round((coalesce(v_user.balance_usd, 0) + v_amount)::numeric, 2);
  v_reference := 'KHD-SUPPORT-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(v_key), 1, 8));

  update public.domain_users
  set balance_usd = v_new_balance,
      updated_at = now()
  where id = v_user.id;

  insert into public.domain_wallet_transactions(
    user_id,
    transaction_type,
    amount_usd,
    balance_after_usd,
    reference,
    idempotency_key,
    metadata
  ) values (
    v_user.id,
    'manual_credit',
    v_amount,
    v_new_balance,
    v_reference,
    v_key,
    jsonb_build_object(
      'adminId', v_admin.id,
      'reason', left(coalesce(nullif(trim(p_reason), ''), 'Manual support credit'), 500),
      'source', 'support'
    )
  )
  returning id into v_transaction_id;

  insert into public.domain_notifications(user_id, type, title, message, data)
  values (
    v_user.id,
    'wallet_manual_credit',
    'Balance credited',
    'Support credited $' || to_char(v_amount, 'FM999999990.00') || ' to your account balance.',
    jsonb_build_object('transactionId', v_transaction_id, 'amountUsd', v_amount, 'balanceUsd', v_new_balance)
  );

  insert into public.domain_audit_logs(user_id, action, entity_type, entity_id, metadata)
  values (
    v_admin.id,
    'admin.wallet.manual_credit',
    'user',
    v_user.id,
    jsonb_build_object('transactionId', v_transaction_id, 'amountUsd', v_amount, 'balanceUsd', v_new_balance, 'reason', p_reason)
  );

  return jsonb_build_object(
    'credited', true,
    'transactionId', v_transaction_id,
    'reference', v_reference,
    'amountUsd', v_amount,
    'balanceUsd', v_new_balance
  );
end;
$$;

revoke all on function public.domain_manual_wallet_credit(uuid, uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.domain_manual_wallet_credit(uuid, uuid, numeric, text, text) to service_role;

delete from vault.secrets
where name in ('domain_camerpay_api_token', 'domain_camerpay_callback_secret');

commit;
