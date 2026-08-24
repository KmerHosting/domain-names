-- Direct DomainNameAPI storefront: one environment, live provider prices, no domain wallet.

alter table public.domain_orders drop constraint if exists domain_orders_tld_fkey;
alter table public.domain_domains drop constraint if exists domain_domains_tld_fkey;

update public.domain_config
set customer_checkout_environment = registrar_environment,
    payment_mode = 'direct_dna',
    wallet_topup_mode = 'disabled',
    updated_at = now()
where id = true;

create or replace function public.domain_keep_single_environment()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  new.customer_checkout_environment := new.registrar_environment;
  return new;
end
$function$;

drop trigger if exists domain_config_single_environment on public.domain_config;
create trigger domain_config_single_environment
before insert or update of registrar_environment, customer_checkout_environment on public.domain_config
for each row execute function public.domain_keep_single_environment();

create or replace function public.domain_checkout_direct(p_user_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cfg public.domain_config%rowtype;
  v_user public.domain_users%rowtype;
  v_order public.domain_orders%rowtype;
  v_quote public.domain_provider_quotes%rowtype;
  v_env text;
  v_test boolean;
  v_method text;
  v_payment uuid;
  v_job text;
  v_invoice text;
  v_ledger uuid;
  v_balance_micros bigint;
  v_balance_cents bigint;
  v_applied boolean;
begin
  select * into v_cfg from public.domain_config where id=true;
  if not found then raise exception 'configuration_missing'; end if;
  if v_cfg.maintenance_mode then raise exception 'maintenance_mode'; end if;

  select * into v_user from public.domain_users where id=p_user_id and status='active';
  if not found then raise exception 'domain_user_not_found'; end if;
  select * into v_order from public.domain_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'order_not_found'; end if;

  v_env := lower(v_order.registrar_environment);
  if v_env not in ('ote','production') then raise exception 'unsupported_registrar_environment'; end if;
  if v_env <> lower(v_cfg.registrar_environment) then raise exception 'order_environment_mismatch'; end if;
  v_test := v_env='ote';
  v_method := case when v_test then 'ote_test' else 'central_credit' end;

  if v_order.status='completed' then
    return jsonb_build_object('paid',false,'alreadyCompleted',true,'orderStatus',v_order.status,'registrarEnvironment',v_env,'testMode',v_test,'paymentMethod',v_method);
  end if;
  if v_order.status in ('paid','queued','processing') then
    return jsonb_build_object('paid',false,'alreadyPaid',true,'orderStatus',v_order.status,'registrarEnvironment',v_env,'testMode',v_test,'paymentMethod',v_method);
  end if;
  if v_order.status not in ('pending_payment','payment_pending') then raise exception 'order_not_payable'; end if;

  select * into v_quote from public.domain_provider_quotes where id=v_order.provider_quote_id and user_id=p_user_id for update;
  if not found or not v_quote.eligible or v_quote.expires_at<=now() then raise exception 'provider_quote_invalid'; end if;
  if lower(v_quote.registrar_environment)<>v_env then raise exception 'quote_environment_mismatch'; end if;
  if round(v_quote.customer_price_usd,2)<>round(v_order.price_usd,2) then raise exception 'quote_price_mismatch'; end if;
  if v_quote.provider_cost_usd<=0 or round(v_order.price_usd,2)<round(v_quote.provider_cost_usd*1.30,2) then raise exception 'price_margin_invalid'; end if;

  if not v_test then
    select ledger_id,balance_micros,balance_cents,applied
    into v_ledger,v_balance_micros,v_balance_cents,v_applied
    from public.dashboard_apply_product_credit(
      'domain',p_user_id::text,-round(v_order.price_usd*1000000)::bigint,'service_debit',
      'domain-order:'||v_order.id::text,v_order.order_number,
      'Domain order '||v_order.domain_name,
      jsonb_build_object('orderId',v_order.id,'domainName',v_order.domain_name,'operation',v_order.type,'registrarEnvironment',v_env)
    );
  end if;

  insert into public.domain_payments(
    order_id,user_id,provider,merchant_invoice_id,provider_reference,idempotency_key,
    amount_usd,amount_xaf,currency,payment_method,status,raw_payload,verified_webhook,paid_at,processed_at,registrar_environment
  ) values (
    v_order.id,v_user.id,case when v_test then 'domainnameapi_ote' else 'kmerhosting_central' end,
    case when v_test then 'KHD-OTE-' else 'KHD-CENTRAL-' end||replace(v_order.id::text,'-',''),
    v_ledger::text,'direct-order:'||v_order.id::text,
    case when v_test then 0 else v_order.price_usd end,
    case when v_test then 0 else v_order.amount_xaf end,'USD',v_method,'paid',
    jsonb_build_object('centralLedgerId',v_ledger,'centralBalanceMicros',v_balance_micros,'chargedCentralUsd',case when v_test then 0 else v_order.price_usd end,'registrarEnvironment',v_env,'testMode',v_test),
    true,now(),now(),v_env
  )
  on conflict(idempotency_key) do update set
    status='paid',paid_at=coalesce(public.domain_payments.paid_at,now()),processed_at=coalesce(public.domain_payments.processed_at,now()),
    raw_payload=public.domain_payments.raw_payload||excluded.raw_payload
  returning id into v_payment;

  update public.domain_orders set status='paid',paid_at=coalesce(paid_at,now()),payment_method=v_method,failure_code=null,failure_message=null,updated_at=now() where id=v_order.id;
  v_job := case v_order.type when 'registration' then 'register_domain' when 'transfer' then 'transfer_domain' when 'renewal' then 'renew_domain' when 'restore' then 'restore_domain' end;
  perform public.domain_enqueue_job(v_job,v_job||':'||v_order.id::text,v_user.id,v_order.id,v_order.domain_id,jsonb_build_object('providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test),now());

  if not v_test then
    v_invoice := 'KHD-INV-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_order.id::text),1,8));
    insert into public.domain_invoices(invoice_number,user_id,order_id,amount_usd,amount_xaf,status,metadata,registrar_environment)
    values(v_invoice,v_user.id,v_order.id,v_order.price_usd,v_order.amount_xaf,'paid',jsonb_build_object('paymentId',v_payment,'centralLedgerId',v_ledger,'registrarEnvironment',v_env),v_env)
    on conflict(order_id) do nothing;
  end if;

  insert into public.domain_notifications(user_id,type,title,message,data)
  values(v_user.id,'payment_paid',case when v_test then '[TEST] Order queued' else 'Order paid and queued' end,
    case when v_test then 'No central credit was charged. The order for '||v_order.domain_name||' was sent to DNA OTE.' else 'The order for '||v_order.domain_name||' was charged to your central KmerHosting balance and queued.' end,
    jsonb_build_object('orderId',v_order.id,'paymentId',v_payment,'centralLedgerId',v_ledger,'registrarEnvironment',v_env,'testMode',v_test));

  return jsonb_build_object('paid',true,'orderStatus','paid','paymentId',v_payment,'centralLedgerId',v_ledger,
    'centralBalanceMicros',v_balance_micros,'centralBalanceUsd',case when v_balance_micros is null then null else v_balance_micros/1000000.0 end,
    'chargedCentralUsd',case when v_test then 0 else v_order.price_usd end,'registrarEnvironment',v_env,'testMode',v_test,'paymentMethod',v_method);
end
$function$;

revoke all on function public.domain_checkout_direct(uuid,uuid) from public,anon,authenticated;
grant execute on function public.domain_checkout_direct(uuid,uuid) to service_role;

create or replace function public.domain_refund_order_direct(p_order_id uuid, p_reason text default 'Order could not be completed.')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order public.domain_orders%rowtype;
  v_ledger uuid;
  v_balance_micros bigint;
  v_balance_cents bigint;
  v_applied boolean;
begin
  select * into v_order from public.domain_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
  if v_order.paid_at is null then return jsonb_build_object('ok',false,'reason','order_not_paid'); end if;
  if v_order.status='refunded' then return jsonb_build_object('ok',true,'alreadyRefunded',true); end if;

  if lower(v_order.registrar_environment)='production' and v_order.payment_method='central_credit' then
    select ledger_id,balance_micros,balance_cents,applied
    into v_ledger,v_balance_micros,v_balance_cents,v_applied
    from public.dashboard_apply_product_credit(
      'domain',v_order.user_id::text,round(v_order.price_usd*1000000)::bigint,'service_refund',
      'domain-refund:'||v_order.id::text,v_order.order_number,
      'Refund for domain order '||v_order.domain_name,
      jsonb_build_object('orderId',v_order.id,'domainName',v_order.domain_name,'reason',left(coalesce(p_reason,''),500),'registrarEnvironment','production')
    );
  end if;

  update public.domain_orders set status='refunded',failure_code='provider_operation_refunded',failure_message=p_reason,updated_at=now() where id=v_order.id;
  update public.domain_payments set status='refunded',processed_at=now(),updated_at=now(),raw_payload=raw_payload||jsonb_build_object('refundLedgerId',v_ledger,'refundReason',p_reason) where order_id=v_order.id and status='paid';
  update public.domain_invoices set status='refunded',metadata=metadata||jsonb_build_object('refundLedgerId',v_ledger,'refundReason',p_reason) where order_id=v_order.id;
  return jsonb_build_object('ok',true,'centralLedgerId',v_ledger,'centralBalanceMicros',v_balance_micros,'registrarEnvironment',v_order.registrar_environment,'testMode',v_order.registrar_environment='ote');
end
$function$;

revoke all on function public.domain_refund_order_direct(uuid,text) from public,anon,authenticated;
grant execute on function public.domain_refund_order_direct(uuid,text) to service_role;

do $block$
declare v_name text;
begin
  foreach v_name in array array['domain-provider-balance-snapshots','domain-tld-provider-catalog','domain-dns-auto-sync'] loop
    begin perform cron.unschedule(v_name); exception when others then null; end;
  end loop;
end
$block$;
