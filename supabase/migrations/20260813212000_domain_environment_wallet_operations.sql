-- Wallet debit/refund follow the immutable registrar environment of the order.

create or replace function public.domain_set_checkout_environment(p_environment text)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_env text:=lower(trim(coalesce(p_environment,'')));
begin
  if v_env not in ('ote','production') then raise exception 'invalid_registrar_environment'; end if;
  if not exists(select 1 from public.domain_provider_environments where environment=v_env and enabled) then raise exception 'registrar_environment_disabled'; end if;
  update public.domain_provider_environments set customer_checkout_enabled=(environment=v_env),updated_at=now();
  update public.domain_config set customer_checkout_environment=v_env,registrar_environment=v_env,updated_at=now() where id=true;
  perform set_config('app.domain_wallet_write','allowed',true);
  update public.domain_users u set balance_usd=coalesce((select b.balance_usd from public.domain_user_environment_balances b where b.user_id=u.id and b.registrar_environment=v_env),0),updated_at=now();
  return jsonb_build_object('customerCheckoutEnvironment',v_env,'testMode',v_env='ote');
end $$;
revoke all on function public.domain_set_checkout_environment(text) from public,anon,authenticated;

create or replace function public.domain_manual_wallet_credit(p_admin_id uuid,p_user_id uuid,p_amount_usd numeric,p_reason text default 'Manual support credit',p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  return public.domain_manual_wallet_credit_env(p_admin_id,p_user_id,public.domain_current_registrar_environment(),p_amount_usd,p_reason,p_idempotency_key);
end $$;

create or replace function public.domain_wallet_pay_order(p_user_id uuid,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare
 v_cfg public.domain_config%rowtype; v_user public.domain_users%rowtype; v_order public.domain_orders%rowtype; v_quote public.domain_provider_quotes%rowtype;
 v_env text; v_test boolean; v_balance numeric(12,2); v_new numeric(12,2); v_tx uuid; v_payment uuid; v_job text; v_invoice text;
begin
 select * into v_cfg from public.domain_config where id=true;
 if not found then raise exception 'configuration_missing'; end if;
 if v_cfg.maintenance_mode then raise exception 'maintenance_mode'; end if;
 if coalesce(v_cfg.payment_mode,'')<>'wallet_only' then raise exception 'wallet_only_required'; end if;
 select * into v_user from public.domain_users where id=p_user_id and status='active';
 if not found then raise exception 'wallet_user_not_found'; end if;
 select * into v_order from public.domain_orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'order_not_found'; end if;
 v_env:=lower(v_order.registrar_environment); if v_env not in ('ote','production') then raise exception 'unsupported_registrar_environment'; end if;
 v_test:=v_env='ote';
 if v_order.status='completed' then return jsonb_build_object('paid',false,'alreadyCompleted',true,'orderStatus',v_order.status,'registrarEnvironment',v_env,'testMode',v_test); end if;
 if v_order.status in ('paid','queued','processing') then return jsonb_build_object('paid',false,'alreadyPaid',true,'orderStatus',v_order.status,'registrarEnvironment',v_env,'testMode',v_test); end if;
 if v_order.status not in ('pending_payment','payment_pending') then raise exception 'order_not_payable_from_wallet'; end if;
 v_quote:=public.domain_validate_wallet_order_quote(v_order);
 if lower(v_quote.registrar_environment)<>v_env then raise exception 'quote_environment_mismatch'; end if;
 insert into public.domain_user_environment_balances(user_id,registrar_environment,balance_usd) values(v_user.id,v_env,0) on conflict do nothing;
 select balance_usd into v_balance from public.domain_user_environment_balances where user_id=v_user.id and registrar_environment=v_env for update;
 if v_balance<v_order.price_usd then raise exception 'insufficient_wallet_balance'; end if;
 v_new:=round((v_balance-v_order.price_usd)::numeric,2);
 update public.domain_user_environment_balances set balance_usd=v_new,updated_at=now() where user_id=v_user.id and registrar_environment=v_env;
 insert into public.domain_wallet_transactions(user_id,transaction_type,amount_usd,balance_after_usd,reference,idempotency_key,metadata,registrar_environment)
 values(v_user.id,'order_debit',-v_order.price_usd,v_new,v_order.order_number,'wallet-order:'||v_order.id::text,jsonb_build_object('orderId',v_order.id,'domainName',v_order.domain_name,'providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test),v_env)
 on conflict(idempotency_key) do update set metadata=public.domain_wallet_transactions.metadata||excluded.metadata returning id into v_tx;
 insert into public.domain_payments(order_id,user_id,provider,merchant_invoice_id,provider_reference,idempotency_key,amount_usd,amount_xaf,currency,payment_method,status,raw_payload,verified_webhook,paid_at,processed_at,registrar_environment)
 values(v_order.id,v_user.id,'wallet','KHD-WAL-'||replace(v_order.id::text,'-',''),v_tx::text,'wallet-order:'||v_order.id::text,v_order.price_usd,v_order.amount_xaf,'USD','wallet','paid',jsonb_build_object('walletTransactionId',v_tx,'balanceAfterUsd',v_new,'registrarEnvironment',v_env,'testMode',v_test),true,now(),now(),v_env)
 on conflict(idempotency_key) do update set status='paid',paid_at=coalesce(public.domain_payments.paid_at,now()),processed_at=coalesce(public.domain_payments.processed_at,now()),raw_payload=public.domain_payments.raw_payload||excluded.raw_payload returning id into v_payment;
 update public.domain_orders set status='paid',paid_at=coalesce(paid_at,now()),payment_method='wallet',failure_code=null,failure_message=null,updated_at=now() where id=v_order.id;
 v_job:=case v_order.type when 'registration' then 'register_domain' when 'transfer' then 'transfer_domain' when 'renewal' then 'renew_domain' when 'restore' then 'restore_domain' end;
 perform public.domain_enqueue_job(v_job,v_job||':'||v_order.id::text,v_user.id,v_order.id,v_order.domain_id,jsonb_build_object('providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test),now());
 v_invoice:=case when v_test then 'KHD-OTE-INV-' else 'KHD-INV-' end||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_order.id::text||random()::text),1,8));
 insert into public.domain_invoices(invoice_number,user_id,order_id,amount_usd,amount_xaf,status,metadata,registrar_environment)
 values(v_invoice,v_user.id,v_order.id,v_order.price_usd,v_order.amount_xaf,'paid',jsonb_build_object('paymentId',v_payment,'registrarEnvironment',v_env,'testMode',v_test),v_env) on conflict(order_id) do nothing;
 insert into public.domain_notifications(user_id,type,title,message,data) values(v_user.id,'payment_paid',case when v_test then '[TEST] Payment confirmed' else 'Payment confirmed' end,(case when v_test then '[TEST] ' else '' end)||'Payment for '||v_order.domain_name||' was paid from your '||upper(v_env)||' balance.',jsonb_build_object('orderId',v_order.id,'registrarEnvironment',v_env,'testMode',v_test));
 return jsonb_build_object('paid',true,'balanceUsd',v_new,'paymentId',v_payment,'transactionId',v_tx,'orderStatus','paid','providerQuoteId',v_quote.id,'registrarEnvironment',v_env,'testMode',v_test);
end $$;

create or replace function public.domain_refund_order_to_wallet(p_order_id uuid,p_reason text default 'Order could not be completed.')
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_order public.domain_orders%rowtype; v_env text; v_test boolean; v_balance numeric(12,2); v_new numeric(12,2); v_existing uuid; v_tx uuid;
begin
 select * into v_order from public.domain_orders where id=p_order_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','order_not_found'); end if;
 if v_order.paid_at is null or v_order.price_usd<=0 then return jsonb_build_object('ok',false,'reason','order_not_paid'); end if;
 v_env:=case when lower(v_order.registrar_environment)='production' then 'production' else 'ote' end; v_test:=v_env='ote';
 select id into v_existing from public.domain_wallet_transactions where idempotency_key='order-refund:'||v_order.id::text;
 if v_existing is not null then update public.domain_orders set status='refunded',failure_code=coalesce(failure_code,'refunded_to_balance'),failure_message=coalesce(nullif(failure_message,''),p_reason),updated_at=now() where id=v_order.id; return jsonb_build_object('ok',true,'alreadyRefunded',true,'transactionId',v_existing,'registrarEnvironment',v_env,'testMode',v_test); end if;
 insert into public.domain_user_environment_balances(user_id,registrar_environment,balance_usd) values(v_order.user_id,v_env,0) on conflict do nothing;
 select balance_usd into v_balance from public.domain_user_environment_balances where user_id=v_order.user_id and registrar_environment=v_env for update;
 v_new:=round((v_balance+v_order.price_usd)::numeric,2);
 update public.domain_user_environment_balances set balance_usd=v_new,updated_at=now() where user_id=v_order.user_id and registrar_environment=v_env;
 insert into public.domain_wallet_transactions(user_id,transaction_type,amount_usd,balance_after_usd,reference,idempotency_key,metadata,registrar_environment)
 values(v_order.user_id,'refund_credit',v_order.price_usd,v_new,v_order.order_number,'order-refund:'||v_order.id::text,jsonb_build_object('orderId',v_order.id,'domainName',v_order.domain_name,'reason',p_reason,'registrarEnvironment',v_env,'testMode',v_test),v_env) returning id into v_tx;
 update public.domain_orders set status='refunded',failure_code='refunded_to_balance',failure_message=p_reason,updated_at=now() where id=v_order.id;
 insert into public.domain_notifications(user_id,type,title,message,data) values(v_order.user_id,'billing',case when v_test then '[TEST] Order refunded to balance' else 'Order refunded to balance' end,(case when v_test then '[TEST] ' else '' end)||'The amount for '||v_order.domain_name||' was credited back to your '||upper(v_env)||' balance.',jsonb_build_object('orderId',v_order.id,'transactionId',v_tx,'registrarEnvironment',v_env,'testMode',v_test));
 return jsonb_build_object('ok',true,'transactionId',v_tx,'balanceAfterUsd',v_new,'registrarEnvironment',v_env,'testMode',v_test);
end $$;
