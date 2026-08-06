-- DomainNameAPI contract, pricing, wallet and environment hardening.
-- Provider-mutating tests must use OTE. Customer paid orders remain production-only.

alter table public.domain_tld_prices
  add column if not exists restore_price_usd numeric(12,2),
  add column if not exists restore_cost_usd numeric(12,2),
  add column if not exists restore_sync_status text not null default 'pending',
  add column if not exists restore_sync_error text,
  add column if not exists registration_periods integer[] not null default array[1],
  add column if not exists renewal_periods integer[] not null default array[1],
  add column if not exists transfer_periods integer[] not null default array[1],
  add column if not exists provider_attributes jsonb not null default '[]'::jsonb,
  add column if not exists provider_lifecycle jsonb not null default '{}'::jsonb,
  add column if not exists provider_price_group text not null default 'Reseller';

alter table public.domain_orders
  add column if not exists tld_attributes jsonb not null default '{}'::jsonb,
  add column if not exists provider_premium boolean not null default false,
  add column if not exists provider_price_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists privacy_requested boolean not null default true,
  add column if not exists lock_requested boolean not null default true;

alter table public.domain_provider_quotes
  add column if not exists provider_currency text not null default 'USD',
  add column if not exists provider_price_group text not null default 'Reseller',
  add column if not exists pricing_metadata jsonb not null default '{}'::jsonb,
  add column if not exists consumed_at timestamptz;

alter table public.domain_payments
  add column if not exists amount_usd numeric(12,2);

alter table public.domain_contacts
  add column if not exists registrar_handles jsonb not null default '{}'::jsonb,
  add column if not exists registrar_verification jsonb not null default '{}'::jsonb;

create table if not exists public.domain_tld_period_prices (
  tld text not null references public.domain_tld_prices(tld) on update cascade on delete cascade,
  operation text not null check (operation in ('registration','renewal','transfer','restore')),
  period_years integer not null check (period_years between 1 and 10),
  registrar_environment text not null check (registrar_environment in ('ote','production')),
  provider_cost_usd numeric(12,2) not null check (provider_cost_usd >= 0),
  customer_price_usd numeric(12,2) not null check (customer_price_usd >= 0),
  currency text not null default 'USD',
  price_group text not null default 'Reseller',
  provider_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (tld, operation, period_years, registrar_environment)
);

create table if not exists public.domain_contact_assignments (
  domain_id uuid not null references public.domain_domains(id) on delete cascade,
  user_id uuid not null references public.domain_users(id) on delete cascade,
  contact_id uuid not null references public.domain_contacts(id) on delete restrict,
  contact_role text not null check (contact_role in ('Registrant','Administrative','Technical','Billing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (domain_id, contact_role)
);

create index if not exists domain_tld_period_prices_lookup_idx
  on public.domain_tld_period_prices(registrar_environment,tld,operation,period_years);
create index if not exists domain_contact_assignments_user_idx
  on public.domain_contact_assignments(user_id,domain_id);
create index if not exists domain_contact_assignments_contact_idx
  on public.domain_contact_assignments(contact_id);

alter table public.domain_tld_period_prices enable row level security;
alter table public.domain_contact_assignments enable row level security;
revoke all on public.domain_tld_period_prices from anon, authenticated;
revoke all on public.domain_contact_assignments from anon, authenticated;

create or replace function public.domain_order_operation(p_type text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_type
    when 'registration' then 'registration'
    when 'transfer' then 'transfer'
    when 'renewal' then 'renewal'
    when 'restore' then 'restore'
    else null
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
begin
  if v_operation is null then raise exception 'unsupported_order_type'; end if;
  if p_order.registrar_environment <> 'production' then raise exception 'wallet_payment_requires_production_order'; end if;
  if p_order.provider_quote_id is null then raise exception 'provider_quote_required'; end if;

  select * into v_quote
  from public.domain_provider_quotes
  where id = p_order.provider_quote_id
    and user_id = p_order.user_id
    and lower(domain_name) = lower(p_order.domain_name)
    and operation = v_operation
    and period_years = p_order.years
    and registrar_environment = p_order.registrar_environment
  for update;

  if not found then raise exception 'provider_quote_mismatch'; end if;
  if not v_quote.eligible then raise exception 'provider_quote_not_eligible'; end if;
  if v_quote.expires_at <= now() then raise exception 'provider_quote_expired'; end if;
  if round(coalesce(v_quote.customer_price_usd,0),2) <> round(coalesce(p_order.price_usd,0),2) then
    raise exception 'provider_quote_customer_price_mismatch';
  end if;
  if coalesce(v_quote.provider_cost_usd,0) <= 0 then raise exception 'provider_cost_missing'; end if;
  if p_order.provider_required_cost_usd is null
     or round(p_order.provider_required_cost_usd,2) <> round(v_quote.provider_cost_usd,2) then
    raise exception 'provider_required_cost_mismatch';
  end if;
  if v_quote.provider_balance_verified_at is null
     or v_quote.provider_balance_verified_at < now() - interval '10 minutes' then
    raise exception 'provider_balance_check_stale';
  end if;
  if coalesce(v_quote.provider_balance_usd,-1) < v_quote.provider_cost_usd then
    raise exception 'provider_balance_too_low';
  end if;
  if p_order.type = 'registration' and v_quote.premium_detected
     and coalesce(v_quote.provider_exact_cost_usd,0) <= 0 then
    raise exception 'premium_exact_price_required';
  end if;
  return v_quote;
end
$$;

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
)
returns public.domain_orders
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
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')), '');
  v_ns text[];
begin
  select * into v_cfg from public.domain_config where id=true;
  if not found then raise exception 'configuration_missing'; end if;
  if v_cfg.registrar_environment <> 'production' then raise exception 'live_order_requires_production_environment'; end if;
  if v_cfg.maintenance_mode then raise exception 'maintenance_mode'; end if;

  select * into v_quote
  from public.domain_provider_quotes
  where id=p_quote_id and user_id=p_user_id
  for update;
  if not found then raise exception 'provider_quote_not_found'; end if;
  if not v_quote.eligible then raise exception 'provider_quote_not_eligible'; end if;
  if v_quote.expires_at <= now() then raise exception 'provider_quote_expired'; end if;
  if v_quote.registrar_environment <> 'production' then raise exception 'live_order_requires_production_quote'; end if;
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
    if found then return v_existing; end if;
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
  end if;

  v_ns := array(select distinct lower(trim(x)) from unnest(coalesce(p_nameservers,'{}'::text[])) x where trim(x) <> '');
  if v_type='registration' and (coalesce(array_length(v_ns,1),0) < 2 or array_length(v_ns,1) > 13) then
    raise exception 'invalid_nameservers';
  end if;
  if v_type='transfer' and coalesce(length(p_auth_code_ciphertext),0)=0 then raise exception 'auth_code_required'; end if;

  insert into public.domain_orders(
    order_number,idempotency_key,user_id,contact_id,domain_id,type,domain_name,tld,years,status,
    price_usd,usd_to_xaf_rate,amount_xaf,auth_code_ciphertext,nameservers,contact_snapshot,
    provider_quote_id,provider_checked_at,provider_required_cost_usd,provider_balance_checked_at,
    registrar_environment,tld_attributes,provider_premium,provider_price_snapshot,privacy_requested,lock_requested
  ) values (
    case v_type when 'registration' then 'KHD-REG-' when 'transfer' then 'KHD-TRN-' when 'renewal' then 'KHD-REN-' else 'KHD-RST-' end ||
      to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_quote.id::text||clock_timestamp()::text),1,8)),
    v_key,p_user_id,p_contact_id,p_domain_id,v_type,lower(v_quote.domain_name),v_quote.tld,v_quote.period_years,'pending_payment',
    round(v_quote.customer_price_usd,2),v_cfg.usd_to_xaf_rate,ceil(v_quote.customer_price_usd*v_cfg.usd_to_xaf_rate)::int,
    p_auth_code_ciphertext,case when coalesce(array_length(v_ns,1),0)>0 then v_ns else coalesce(v_domain.nameservers,'{}'::text[]) end,
    coalesce(p_contact_snapshot,'{}'::jsonb),v_quote.id,now(),v_quote.provider_cost_usd,v_quote.provider_balance_verified_at,
    'production',coalesce(p_tld_attributes,'{}'::jsonb),v_quote.premium_detected,
    jsonb_build_object('quoteId',v_quote.id,'source',v_quote.source,'providerCostUsd',v_quote.provider_cost_usd,'customerPriceUsd',v_quote.customer_price_usd,'pricingMetadata',v_quote.pricing_metadata),
    p_privacy_requested,p_lock_requested
  ) returning * into v_order;

  update public.domain_provider_quotes set order_id=v_order.id,consumed_at=now() where id=v_quote.id;
  return v_order;
end
$$;

create or replace function public.domain_guard_paid_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.type in ('registration','transfer','renewal','restore')
     and new.payment_method = 'wallet'
     and new.status = 'paid'
     and old.status not in ('paid','processing','completed') then
    perform public.domain_validate_wallet_order_quote(new);
  end if;
  if new.type in ('registration','transfer','renewal','restore')
     and new.status in ('processing','completed')
     and new.provider_quote_id is null then
    raise exception 'provider_quote_required_for_provisioning';
  end if;
  return new;
end
$$;

drop trigger if exists domain_guard_paid_order_transition on public.domain_orders;
create trigger domain_guard_paid_order_transition
before update on public.domain_orders
for each row execute function public.domain_guard_paid_order_transition();

create or replace function public.domain_guard_wallet_balance_write()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.balance_usd is distinct from old.balance_usd
     and coalesce(current_setting('app.domain_wallet_write',true),'') <> 'allowed' then
    raise exception 'direct_wallet_balance_write_blocked';
  end if;
  return new;
end
$$;

drop trigger if exists domain_guard_wallet_balance_write on public.domain_users;
create trigger domain_guard_wallet_balance_write
before update of balance_usd on public.domain_users
for each row execute function public.domain_guard_wallet_balance_write();

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
set search_path=public,pg_temp
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
  select * into v_admin from public.domain_users where id=p_admin_id and role='admin' and status='active';
  if not found then raise exception 'admin_required'; end if;
  v_amount:=round(coalesce(p_amount_usd,0)::numeric,2);
  if v_amount<=0 or v_amount>100000 then raise exception 'invalid_credit_amount'; end if;
  v_key:=coalesce(nullif(trim(coalesce(p_idempotency_key,'')),''),'manual-support-credit:'||p_user_id::text||':'||md5(clock_timestamp()::text||random()::text));
  select * into v_existing from public.domain_wallet_transactions where idempotency_key=v_key limit 1;
  if found then return jsonb_build_object('credited',false,'alreadyCredited',true,'transactionId',v_existing.id,'balanceUsd',v_existing.balance_after_usd); end if;
  select * into v_user from public.domain_users where id=p_user_id and status<>'deleted' for update;
  if not found then raise exception 'wallet_user_not_found'; end if;
  v_new_balance:=round((coalesce(v_user.balance_usd,0)+v_amount)::numeric,2);
  perform set_config('app.domain_wallet_write','allowed',true);
  update public.domain_users set balance_usd=v_new_balance,updated_at=now() where id=v_user.id;
  v_reference:='KHD-SUPPORT-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_key),1,8));
  insert into public.domain_wallet_transactions(user_id,transaction_type,amount_usd,balance_after_usd,reference,idempotency_key,metadata)
  values(v_user.id,'manual_credit',v_amount,v_new_balance,v_reference,v_key,jsonb_build_object('adminId',v_admin.id,'reason',left(coalesce(nullif(trim(p_reason),''),'Manual support credit'),500),'source','support'))
  returning id into v_transaction_id;
  insert into public.domain_notifications(user_id,type,title,message,data)
  values(v_user.id,'wallet_manual_credit','Balance credited','Support credited $'||to_char(v_amount,'FM999999990.00')||' to your account balance.',jsonb_build_object('transactionId',v_transaction_id,'amountUsd',v_amount,'balanceUsd',v_new_balance));
  insert into public.domain_audit_logs(user_id,action,entity_type,entity_id,metadata)
  values(v_admin.id,'admin.wallet.manual_credit','user',v_user.id,jsonb_build_object('transactionId',v_transaction_id,'amountUsd',v_amount,'balanceUsd',v_new_balance,'reason',p_reason));
  return jsonb_build_object('credited',true,'transactionId',v_transaction_id,'reference',v_reference,'amountUsd',v_amount,'balanceUsd',v_new_balance);
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
begin
  select * into v_cfg from public.domain_config where id=true;
  if v_cfg.maintenance_mode then raise exception 'maintenance_mode'; end if;
  if coalesce(v_cfg.payment_mode,'')<>'wallet_only' then raise exception 'wallet_only_required'; end if;
  if coalesce(v_cfg.wallet_topup_mode,'')<>'manual_support' then raise exception 'manual_support_topup_required'; end if;
  if v_cfg.registrar_environment<>'production' then raise exception 'production_registrar_required'; end if;

  select * into v_user from public.domain_users where id=p_user_id and status='active' for update;
  if not found then raise exception 'wallet_user_not_found'; end if;
  select * into v_order from public.domain_orders where id=p_order_id and user_id=p_user_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.status='completed' then return jsonb_build_object('paid',false,'alreadyCompleted',true,'balanceUsd',v_user.balance_usd,'orderStatus',v_order.status); end if;
  if v_order.status in ('paid','queued','processing') then return jsonb_build_object('paid',false,'alreadyPaid',true,'balanceUsd',v_user.balance_usd,'orderStatus',v_order.status); end if;
  if v_order.status not in ('pending_payment','payment_pending') then raise exception 'order_not_payable_from_wallet'; end if;

  v_quote:=public.domain_validate_wallet_order_quote(v_order);
  if v_user.balance_usd<v_order.price_usd then raise exception 'insufficient_wallet_balance'; end if;
  v_new_balance:=round((v_user.balance_usd-v_order.price_usd)::numeric,2);
  perform set_config('app.domain_wallet_write','allowed',true);
  update public.domain_users set balance_usd=v_new_balance,updated_at=now() where id=v_user.id;

  insert into public.domain_wallet_transactions(user_id,transaction_type,amount_usd,balance_after_usd,reference,idempotency_key,metadata)
  values(v_user.id,'order_debit',-v_order.price_usd,v_new_balance,v_order.order_number,'wallet-order:'||v_order.id::text,
    jsonb_build_object('orderId',v_order.id,'domainName',v_order.domain_name,'orderType',v_order.type,'providerQuoteId',v_quote.id,'registrarEnvironment',v_order.registrar_environment))
  on conflict(idempotency_key) do update set metadata=public.domain_wallet_transactions.metadata||excluded.metadata
  returning id into v_transaction_id;

  insert into public.domain_payments(order_id,user_id,provider,merchant_invoice_id,provider_reference,idempotency_key,amount_usd,amount_xaf,currency,payment_method,status,checkout_url,raw_payload,verified_webhook,paid_at,processed_at)
  values(v_order.id,v_user.id,'wallet','KHD-WAL-'||replace(v_order.id::text,'-',''),v_transaction_id::text,'wallet-order:'||v_order.id::text,
    v_order.price_usd,v_order.amount_xaf,'USD','wallet','paid',null,
    jsonb_build_object('walletTransactionId',v_transaction_id,'amountUsd',v_order.price_usd,'balanceAfterUsd',v_new_balance,'providerQuoteId',v_quote.id),true,now(),now())
  on conflict(idempotency_key) do update set status='paid',paid_at=coalesce(public.domain_payments.paid_at,now()),processed_at=coalesce(public.domain_payments.processed_at,now()),raw_payload=public.domain_payments.raw_payload||excluded.raw_payload
  returning id into v_payment_id;

  update public.domain_orders
  set status='paid',paid_at=coalesce(paid_at,now()),payment_method='wallet',failure_code=null,failure_message=null,updated_at=now()
  where id=v_order.id;

  v_job_type:=case v_order.type when 'registration' then 'register_domain' when 'transfer' then 'transfer_domain' when 'renewal' then 'renew_domain' when 'restore' then 'restore_domain' end;
  perform public.domain_enqueue_job(v_job_type,v_job_type||':'||v_order.id::text,v_user.id,v_order.id,v_order.domain_id,
    jsonb_build_object('providerQuoteId',v_quote.id,'registrarEnvironment',v_order.registrar_environment),now());

  v_invoice_number:='KHD-INV-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_order.id::text||random()::text),1,8));
  insert into public.domain_invoices(invoice_number,user_id,order_id,amount_usd,amount_xaf,status,metadata)
  values(v_invoice_number,v_user.id,v_order.id,v_order.price_usd,v_order.amount_xaf,'paid',jsonb_build_object('paymentId',v_payment_id,'paymentMethod','wallet','providerQuoteId',v_quote.id))
  on conflict(order_id) do nothing;

  insert into public.domain_notifications(user_id,type,title,message,data)
  values(v_user.id,'payment_paid','Payment confirmed','Payment for '||v_order.domain_name||' was paid from your balance.',jsonb_build_object('orderId',v_order.id))
  on conflict do nothing;

  insert into public.domain_email_outbox(event_key,user_id,order_id,recipient_email,recipient_name,template,subject,payload)
  values('order-paid:'||v_order.id::text,v_user.id,v_order.id,v_user.email,v_user.full_name,'order_paid','Payment confirmed — '||v_order.domain_name,
    jsonb_build_object('name',v_user.full_name,'domainName',v_order.domain_name,'orderNumber',v_order.order_number))
  on conflict(event_key) do nothing;

  return jsonb_build_object('paid',true,'balanceUsd',v_new_balance,'paymentId',v_payment_id,'transactionId',v_transaction_id,'orderStatus','paid','providerQuoteId',v_quote.id);
end
$$;

create or replace function public.domain_refund_order_to_wallet(p_order_id uuid,p_reason text default 'Order could not be completed.')
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_order public.domain_orders%rowtype;
  v_user_balance numeric;
  v_existing uuid;
  v_tx_id uuid;
  v_new_balance numeric;
begin
  select * into v_order from public.domain_orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
  if v_order.paid_at is null or v_order.price_usd<=0 then return jsonb_build_object('ok',false,'reason','order_not_paid'); end if;
  select id into v_existing from public.domain_wallet_transactions where idempotency_key='order-refund:'||v_order.id::text;
  if v_existing is not null then
    update public.domain_orders set status='refunded',failure_code=coalesce(failure_code,'refunded_to_balance'),failure_message=coalesce(nullif(failure_message,''),p_reason),updated_at=now() where id=v_order.id;
    return jsonb_build_object('ok',true,'alreadyRefunded',true,'transactionId',v_existing);
  end if;
  select balance_usd into v_user_balance from public.domain_users where id=v_order.user_id for update;
  if v_user_balance is null then return jsonb_build_object('ok',false,'reason','user_not_found'); end if;
  v_new_balance:=round((v_user_balance+v_order.price_usd)::numeric,2);
  perform set_config('app.domain_wallet_write','allowed',true);
  update public.domain_users set balance_usd=v_new_balance,updated_at=now() where id=v_order.user_id;
  insert into public.domain_wallet_transactions(user_id,transaction_type,amount_usd,balance_after_usd,reference,idempotency_key,metadata)
  values(v_order.user_id,'refund_credit',v_order.price_usd,v_new_balance,v_order.order_number,'order-refund:'||v_order.id::text,
    jsonb_build_object('orderId',v_order.id,'domainName',v_order.domain_name,'reason',p_reason)) returning id into v_tx_id;
  update public.domain_orders set status='refunded',failure_code='refunded_to_balance',failure_message=p_reason,updated_at=now() where id=v_order.id;
  insert into public.domain_notifications(user_id,type,title,message,data)
  values(v_order.user_id,'billing','Order refunded to balance','We could not complete '||v_order.domain_name||'. The amount has been credited to your account balance.',jsonb_build_object('orderId',v_order.id,'transactionId',v_tx_id));
  return jsonb_build_object('ok',true,'transactionId',v_tx_id,'balanceAfterUsd',v_new_balance);
end
$$;

create or replace function public.domain_reject_non_wallet_payment_write()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='INSERT' and coalesce(new.provider,'')<>'wallet' then raise exception 'external_payment_providers_removed'; end if;
  if tg_op='UPDATE' and (new.provider is distinct from old.provider or new.checkout_url is distinct from old.checkout_url) then
    if coalesce(new.provider,'')<>'wallet' or new.checkout_url is not null then raise exception 'external_payment_providers_removed'; end if;
  end if;
  return new;
end
$$;

drop trigger if exists domain_reject_non_wallet_payment_write on public.domain_payments;
create trigger domain_reject_non_wallet_payment_write
before insert or update on public.domain_payments
for each row execute function public.domain_reject_non_wallet_payment_write();

create or replace function public.domain_block_cross_environment_jobs()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_current text:=public.domain_current_registrar_environment();
  v_target text;
begin
  if new.domain_id is not null then select registrar_environment into v_target from public.domain_domains where id=new.domain_id; end if;
  if v_target is null and new.order_id is not null then select registrar_environment into v_target from public.domain_orders where id=new.order_id; end if;
  if v_target is not null and v_target<>v_current
     and new.type in ('register_domain','transfer_domain','renew_domain','restore_domain','update_nameservers','create_dns_record','update_dns_record','delete_dns_record') then
    raise exception 'Blocked cross-environment write job %. Target registrar environment is %, platform is %.',new.type,v_target,v_current;
  end if;
  return new;
end
$$;

alter function public.domain_registrar_proxy_env(text,text,jsonb,jsonb,text) set statement_timeout='20s';
alter function public.domain_registrar_proxy(text,text,jsonb,jsonb) set statement_timeout='20s';

alter view public.domain_dns_records_with_environment set (security_invoker = true);
alter view public.domain_domains_with_environment set (security_invoker = true);
revoke all on public.domain_dns_records_with_environment from anon, authenticated;
revoke all on public.domain_domains_with_environment from anon, authenticated;

-- Edge Functions use the service role. Internal security-definer RPCs must not be callable by clients.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and p.proname like 'domain\_%' escape '\'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.signature);
  end loop;
end $$;

-- Retire duplicate and external-payment workers. Keep one job worker, one lifecycle worker and one catalog sync.
do $$ begin perform cron.unschedule('domain-order-poller'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('domain-transfer-worker'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('domain-tld-progressive-sync'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('domain-dns-auto-sync'); exception when others then null; end $$;

update public.domain_jobs
set status='cancelled',archived_at=now(),archive_reason='obsolete payment-provider job removed',updated_at=now()
where type='check_payment' and status in ('pending','failed','processing','running');
