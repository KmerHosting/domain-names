create or replace function public.domain_finalize_paid_payment(
  p_payment_id uuid,
  p_provider_reference text,
  p_provider_status text,
  p_paid_amount numeric,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.domain_payments%rowtype;
  v_order public.domain_orders%rowtype;
  v_user public.domain_users%rowtype;
  v_now timestamptz := now();
  v_job_type text;
  v_invoice_number text;
begin
  select * into v_payment
  from public.domain_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  select * into v_order
  from public.domain_orders
  where id = v_payment.order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  select * into v_user
  from public.domain_users
  where id = v_order.user_id;

  if lower(coalesce(p_provider_status, '')) not in (
    'paid','success','successful','completed','approved','confirmed','succeeded','done','vire','viré'
  ) then
    raise exception 'payment_status_not_successful';
  end if;

  if p_paid_amount is not null and p_paid_amount < v_payment.amount_xaf then
    raise exception 'payment_amount_mismatch';
  end if;

  if v_payment.status = 'paid' and v_payment.processed_at is not null then
    return jsonb_build_object(
      'payment', to_jsonb(v_payment),
      'order', to_jsonb(v_order),
      'alreadyFinalized', true
    );
  end if;

  update public.domain_payments
  set status = 'paid',
      provider_reference = coalesce(nullif(trim(p_provider_reference), ''), provider_reference),
      raw_payload = coalesce(p_payload, '{}'::jsonb),
      paid_at = coalesce(paid_at, v_now),
      processed_at = v_now,
      updated_at = v_now
  where id = v_payment.id
  returning * into v_payment;

  update public.domain_orders
  set status = 'paid',
      paid_at = coalesce(paid_at, v_now),
      failure_code = null,
      failure_message = null,
      updated_at = v_now
  where id = v_order.id
  returning * into v_order;

  v_job_type := case v_order.type
    when 'registration' then 'register_domain'
    when 'transfer' then 'transfer_domain'
    when 'renewal' then 'renew_domain'
    when 'restore' then 'restore_domain'
    else null
  end;

  if v_job_type is not null then
    perform public.domain_enqueue_job(
      p_type => v_job_type,
      p_idempotency_key => v_job_type || ':' || v_order.id::text,
      p_user_id => v_order.user_id,
      p_order_id => v_order.id,
      p_domain_id => v_order.domain_id,
      p_payload => '{}'::jsonb,
      p_run_after => v_now
    );
  end if;

  v_invoice_number := 'KHD-INV-' || to_char(v_now, 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.domain_invoices(
    invoice_number, user_id, order_id, amount_usd, amount_xaf, status, metadata
  ) values (
    v_invoice_number, v_order.user_id, v_order.id, v_order.price_usd, v_order.amount_xaf, 'paid',
    jsonb_build_object('paymentId', v_payment.id, 'merchantInvoiceId', v_payment.merchant_invoice_id, 'confirmationMode', 'polling')
  )
  on conflict (order_id) do nothing;

  insert into public.domain_email_outbox(
    event_key, recipient_email, recipient_name, template, subject, payload, user_id, order_id, domain_id
  ) values (
    'order-paid:' || v_order.id::text,
    lower(v_user.email),
    v_user.full_name,
    'order_paid',
    'Payment confirmed — ' || v_order.domain_name,
    jsonb_build_object('name', v_user.full_name, 'domainName', v_order.domain_name, 'orderNumber', v_order.order_number),
    v_order.user_id,
    v_order.id,
    v_order.domain_id
  )
  on conflict (event_key) do nothing;

  if not exists (
    select 1 from public.domain_notifications
    where user_id = v_order.user_id
      and type = 'payment_paid'
      and data ->> 'orderId' = v_order.id::text
  ) then
    insert into public.domain_notifications(user_id, type, title, message, data)
    values (
      v_order.user_id,
      'payment_paid',
      'Payment confirmed',
      'Payment for ' || v_order.domain_name || ' is confirmed. Provisioning is automatic.',
      jsonb_build_object('orderId', v_order.id, 'confirmationMode', 'polling')
    );
  end if;

  return jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'order', to_jsonb(v_order),
    'alreadyFinalized', false
  );
end;
$$;

revoke all on function public.domain_finalize_paid_payment(uuid, text, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.domain_finalize_paid_payment(uuid, text, text, numeric, jsonb)
  to service_role;

create or replace function public.domain_invoke_payment_polling()
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
    url := 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-payment-status/internal/poll',
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

revoke all on function public.domain_invoke_payment_polling() from public, anon, authenticated;
grant execute on function public.domain_invoke_payment_polling() to postgres, service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'domain-payment-polling';

select cron.schedule(
  'domain-payment-polling',
  '* * * * *',
  'select public.domain_invoke_payment_polling();'
);

drop function if exists public.domain_invoke_jobs();
