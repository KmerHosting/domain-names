-- Keep test orders, wallet debits and provider operations inside DomainNameAPI OTE.
-- Production remains strict: exact quote + recent provider-balance verification.

create or replace function public.domain_create_order_from_quote(
  p_user_id uuid,
  p_quote_id uuid,
  p_contact_id uuid default null,
  p_domain_id uuid default null,
  p_nameservers text[] default '{}'::text[],
  p_auth_code_ciphertext text default null,
  p_tld_attributes jsonb default '{}'::jsonb,
  p_contact_snapshot jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_privacy_requested boolean default true,
  p_lock_requested boolean default true
) returns public.domain_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.domain_provider_quotes%rowtype;
  v_existing public.domain_orders%rowtype;
  v_order public.domain_orders%rowtype;
  v_domain public.domain_domains%rowtype;
  v_contact public.domain_contacts%rowtype;
  v_cfg public.domain_config%rowtype;
  v_type text;
  v_env text;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')), '');
  v_ns text[];
  v_prefix text;
begin
  select * into v_cfg from public.domain_config where id=true;
  if not found then raise exception 'configuration_missing'; end if;
  v_env := lower(coalesce(v_cfg.registrar_environment,''));
  if v_env not in ('production','ote') then raise exception 'unsupported_registrar_environment'; end if;
  if v_cfg.maintenance_mode then raise exception 'maintenance_mode'; end if;

  select * into v_quote from public.domain_provider_quotes
  where id=p_quote_id and user_id=p_user_id for update;
  if not found then raise exception 'provider_quote_not_found'; end if;
  if not v_quote.eligible then raise exception 'provider_quote_not_eligible'; end if;
  if v_quote.expires_at <= now() then raise exception 'provider_quote_expired'; end if;
  if lower(v_quote.registrar_environment) <> v_env then raise exception 'provider_quote_environment_mismatch'; end if;
  if v_quote.order_id is not null or v_quote.consumed_at is not null then
    select * into v_existing from public.domain_orders where id=v_quote.order_id;
    if found then return v_existing; end if;
    raise exception 'provider_quote_already_consumed';
  end if;

  v_type := case v_quote.operation
    when 'registration' then 'registration'
    when 'transfer' then 'transfer'
    when 'renewal' then 'renewal'
    when 'restore' then 'restore'
    else null end;
  if v_type is null then raise exception 'unsupported_order_type'; end if;

  if v_key is not null then
    select * into v_existing from public.domain_orders
    where user_id=p_user_id and idempotency_key=v_key limit 1;
    if found then
      if lower(v_existing.registrar_environment) <> v_env then raise exception 'idempotency_environment_mismatch'; end if;
      return v_existing;
    end if;
  else
    v_key := 'quote-order:'||v_quote.id::text;
  end if;

  if v_type in ('registration','transfer') then
    if p_contact_id is null then raise exception 'contact_required'; end if;
    select * into v_contact from public.domain_contacts where id=p_contact_id and user_id=p_user_id;
    if not found then raise exception 'contact_not_found'; end if;
  end if;

  if v_type in ('renewal','restore') then
    if p_domain_id is null then raise exception 'domain_required'; end if;
    select * into v_domain from public.domain_domains where id=p_domain_id and user_id=p_user_id;
    if not found then raise exception 'domain_not_found'; end if;
    if lower(v_domain.domain_name) <> lower(v_quote.domain_name) then raise exception 'quote_domain_mismatch'; end if;
    if lower(v_domain.registrar_environment) <> v_env then raise exception 'domain_environment_mismatch'; end if;
  end if;

  v_ns := array(select distinct lower(trim(x)) from unnest(coalesce(p_nameservers,'{}'::text[])) x where trim(x) <> '');
  if v_type='registration' and (coalesce(array_length(v_ns,1),0) < 2 or array_length(v_ns,1) > 13) then raise exception 'invalid_nameservers'; end if;
  if v_type='transfer' and coalesce(length(p_auth_code_ciphertext),0)=0 then raise exception 'auth_code_required'; end if;

  v_prefix := case
    when v_env='ote' and v_type='registration' then 'KHD-OTE-REG-'
    when v_env='ote' and v_type='transfer' then 'KHD-OTE-TRN-'
    when v_env='ote' and v_type='renewal' then 'KHD-OTE-REN-'
    when v_env='ote' then 'KHD-OTE-RST-'
    when v_type='registration' then 'KHD-REG-'
    when v_type='transfer' then 'KHD-TRN-'
    when v_type='renewal' then 'KHD-REN-'
    else 'KHD-RST-'
  end;

  insert into public.domain_orders(
    order_number,idempotency_key,user_id,contact_id,domain_id,type,domain_name,tld,years,status,
    price_usd,usd_to_xaf_rate,amount_xaf,auth_code_ciphertext,nameservers,contact_snapshot,
    provider_quote_id,provider_checked_at,provider_required_cost_usd,provider_balance_checked_at,
    registrar_environment,tld_attributes,provider_premium,provider_price_snapshot,privacy_requested,lock_requested
  ) values (
    v_prefix||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_quote.id::text||clock_timestamp()::text),1,8)),
    v_key,p_user_id,p_contact_id,p_domain_id,v_type,lower(v_quote.domain_name),v_quote.tld,v_quote.period_years,'pending_payment',
    round(v_quote.customer_price_usd,2),v_cfg.usd_to_xaf_rate,ceil(v_quote.customer_price_usd*v_cfg.usd_to_xaf_rate)::int,
    p_auth_code_ciphertext,case when coalesce(array_length(v_ns,1),0)>0 then v_ns else coalesce(v_domain.nameservers,'{}'::text[]) end,
    coalesce(p_contact_snapshot,'{}'::jsonb),v_quote.id,now(),v_quote.provider_cost_usd,v_quote.provider_balance_verified_at,
    v_env,coalesce(p_tld_attributes,'{}'::jsonb),v_quote.premium_detected,
    jsonb_build_object('quoteId',v_quote.id,'source',v_quote.source,'providerCostUsd',v_quote.provider_cost_usd,'customerPriceUsd',v_quote.customer_price_usd,'pricingMetadata',v_quote.pricing_metadata,'registrarEnvironment',v_env,'testMode',v_env='ote'),
    p_privacy_requested,p_lock_requested
  ) returning * into v_order;

  update public.domain_provider_quotes set order_id=v_order.id,consumed_at=now() where id=v_quote.id;
  return v_order;
end
$$;

create or replace function public.domain_validate_wallet_order_quote(p_order public.domain_orders)
returns public.domain_provider_quotes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.domain_provider_quotes%rowtype;
  v_operation text := public.domain_order_operation(p_order.type);
  v_cfg public.domain_config%rowtype;
  v_env text;
begin
  if v_operation is null then raise exception 'unsupported_order_type'; end if;
  select * into v_cfg from public.domain_config where id=true;
  if not found then raise exception 'configuration_missing'; end if;
  v_env := lower(coalesce(v_cfg.registrar_environment,''));
  if v_env not in ('production','ote') then raise exception 'unsupported_registrar_environment'; end if;
  if lower(p_order.registrar_environment) <> v_env then raise exception 'order_environment_mismatch'; end if;
  if p_order.provider_quote_id is null then raise exception 'provider_quote_required'; end if;

  select * into v_quote from public.domain_provider_quotes
  where id=p_order.provider_quote_id
    and user_id=p_order.user_id
    and lower(domain_name)=lower(p_order.domain_name)
    and operation=v_operation
    and period_years=p_order.years
    and lower(registrar_environment)=v_env
  for update;

  if not found then raise exception 'provider_quote_mismatch'; end if;
  if not v_quote.eligible then raise exception 'provider_quote_not_eligible'; end if;
  if v_quote.expires_at <= now() then raise exception 'provider_quote_expired'; end if;
  if round(coalesce(v_quote.customer_price_usd,0),2) <> round(coalesce(p_order.price_usd,0),2) then raise exception 'provider_quote_customer_price_mismatch'; end if;
  if coalesce(v_quote.provider_cost_usd,0) <= 0 then raise exception 'provider_cost_missing'; end if;
  if p_order.provider_required_cost_usd is null or round(p_order.provider_required_cost_usd,2) <> round(v_quote.provider_cost_usd,2) then raise exception 'provider_required_cost_mismatch'; end if;
  if p_order.type='registration' and v_quote.premium_detected and coalesce(v_quote.provider_exact_cost_usd,0)<=0 then raise exception 'premium_exact_price_required'; end if;

  if v_env='production' then
    if v_quote.provider_balance_verified_at is null or v_quote.provider_balance_verified_at < now()-interval '10 minutes' then raise exception 'provider_balance_check_stale'; end if;
    if coalesce(v_quote.provider_balance_usd,-1) < v_quote.provider_cost_usd then raise exception 'provider_balance_too_low'; end if;
  end if;
  return v_quote;
end
$$;

create or replace function public.domain_wallet_pay_order(p_user_id uuid,p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_cfg public.domain_config%rowtype;
  v_user public.domain_users%rowtype;
  v_order public.domain_orders%rowtype;
  v_quote public.domain_provider_quotes%rowtype;
  v_new_balance numeric(12,2);
  v_payment_id uuid;
  v_transaction_id uuid;
  v_invoice_number text;
  v_job_type text;
  v_env text;
  v_test boolean;
  v_label text;
begin
  select * into v_cfg from public.domain_config where id=true;
  if not found then raise exception 'configuration_missing'; end if;
  if v_cfg.maintenance_mode then raise exception 'maintenance_mode'; end if;
  if coalesce(v_cfg.payment_mode,'')<>'wallet_only' then raise exception 'wallet_only_required'; end if;
  if coalesce(v_cfg.wallet_topup_mode,'')<>'manual_support' then raise exception 'manual_support_topup_required'; end if;
  v_env:=lower(coalesce(v_cfg.registrar_environment,''));
  if v_env not in ('production','ote') then raise exception 'unsupported_registrar_environment'; end if;
  v_test:=v_env='ote';
  v_label:=case when v_test then '[TEST] ' else '' end;

  select * into v_user from public.domain_users where id=p_user_id and status='active' for update;
  if not found then raise exception 'wallet_user_not_found'; end if;
  select * into v_order from public.domain_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if lower(v_order.registrar_environment)<>v_env then raise exception 'order_environment_mismatch'; end if;
  if v_order.status='completed' then return jsonb_build_object('paid',false,'alreadyCompleted',true,'balanceUsd',v_user.balance_usd,'orderStatus',v_order.status,'registrarEnvironment',v_env,'testMode',v_test); end if;
  if v_order.status in ('paid','queued','processing') then return jsonb_build_object('paid',false,'alreadyPaid',true,'balanceUsd',v_user.balance_usd,'orderStatus',v_order.status,'registrarEnvironment',v_env,'testMode',v_test); end if;
  if v_order.status not in ('pending_payment','payment_pending') then raise exception 'order_not_payable_from_wallet'; end if;

  v_quote:=public.domain_validate_wallet_order_quote(v_order);
  if v_user.balance_usd<v_order.price_usd then raise exception 'insufficient_wallet_balance'; end if;
  v_new_balance:=round((v_user.balance_usd-v_order.price_usd)::numeric,2);
  perform set_config('app.domain_wallet_write','allowed',true);
  update public.domain_users set balance_usd=v_new_balance,updated_at=now() where id=v_user.id;

  insert into public.domain_wallet_transactions(user_id,transaction_type,amount_usd,balance_after_usd,reference,idempotency_key,metadata)
  values(v_user.id,'order_debit',-v_order.price_usd,v_new_balance,v_order.order_number,'wallet-order:'||v_order.id::text,jsonb_build_object('orderId',v_order.id,'domainName',v_order.domain_name,'orderType',v_order.type,'providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test))
  on conflict(idempotency_key) do update set metadata=public.domain_wallet_transactions.metadata||excluded.metadata returning id into v_transaction_id;

  insert into public.domain_payments(order_id,user_id,provider,merchant_invoice_id,provider_reference,idempotency_key,amount_usd,amount_xaf,currency,payment_method,status,checkout_url,raw_payload,verified_webhook,paid_at,processed_at)
  values(v_order.id,v_user.id,'wallet','KHD-WAL-'||replace(v_order.id::text,'-',''),v_transaction_id::text,'wallet-order:'||v_order.id::text,v_order.price_usd,v_order.amount_xaf,'USD','wallet','paid',null,jsonb_build_object('walletTransactionId',v_transaction_id,'amountUsd',v_order.price_usd,'balanceAfterUsd',v_new_balance,'providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test),true,now(),now())
  on conflict(idempotency_key) do update set status='paid',paid_at=coalesce(public.domain_payments.paid_at,now()),processed_at=coalesce(public.domain_payments.processed_at,now()),raw_payload=public.domain_payments.raw_payload||excluded.raw_payload returning id into v_payment_id;

  update public.domain_orders set status='paid',paid_at=coalesce(paid_at,now()),payment_method='wallet',failure_code=null,failure_message=null,updated_at=now() where id=v_order.id;
  v_job_type:=case v_order.type when 'registration' then 'register_domain' when 'transfer' then 'transfer_domain' when 'renewal' then 'renew_domain' when 'restore' then 'restore_domain' end;
  perform public.domain_enqueue_job(v_job_type,v_job_type||':'||v_order.id::text,v_user.id,v_order.id,v_order.domain_id,jsonb_build_object('providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test),now());

  v_invoice_number:=case when v_test then 'KHD-OTE-INV-' else 'KHD-INV-' end||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_order.id::text||random()::text),1,8));
  insert into public.domain_invoices(invoice_number,user_id,order_id,amount_usd,amount_xaf,status,metadata)
  values(v_invoice_number,v_user.id,v_order.id,v_order.price_usd,v_order.amount_xaf,'paid',jsonb_build_object('paymentId',v_payment_id,'paymentMethod','wallet','providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test)) on conflict(order_id) do nothing;

  insert into public.domain_notifications(user_id,type,title,message,data)
  values(v_user.id,'payment_paid',v_label||'Payment confirmed',v_label||'Payment for '||v_order.domain_name||' was paid from your balance.',jsonb_build_object('orderId',v_order.id,'registrarEnvironment',v_env,'testMode',v_test)) on conflict do nothing;

  insert into public.domain_email_outbox(event_key,user_id,order_id,recipient_email,recipient_name,template,subject,payload)
  values('order-paid:'||v_order.id::text,v_user.id,v_order.id,v_user.email,v_user.full_name,'order_paid',v_label||'Payment confirmed — '||v_order.domain_name,jsonb_build_object('name',v_user.full_name,'domainName',v_order.domain_name,'orderNumber',v_order.order_number,'registrarEnvironment',v_env,'testMode',v_test)) on conflict(event_key) do nothing;

  return jsonb_build_object('paid',true,'balanceUsd',v_new_balance,'paymentId',v_payment_id,'transactionId',v_transaction_id,'orderStatus','paid','providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test);
end
$$;
