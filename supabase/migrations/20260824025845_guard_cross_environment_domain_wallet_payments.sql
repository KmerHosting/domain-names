-- Prevent TEST / OTE checkout from paying LIVE orders, and vice versa.
-- Historical orders remain visible but require their matching checkout environment.

create or replace function public.domain_wallet_pay_order(p_user_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
 v_cfg public.domain_config%rowtype; v_user public.domain_users%rowtype; v_order public.domain_orders%rowtype; v_quote public.domain_provider_quotes%rowtype;
 v_env text; v_checkout_env text; v_test boolean; v_balance numeric(12,2); v_new numeric(12,2); v_tx uuid; v_payment uuid; v_job text; v_invoice text;
begin
 select * into v_cfg from public.domain_config where id=true;
 if not found then raise exception 'configuration_missing'; end if;
 if v_cfg.maintenance_mode then raise exception 'maintenance_mode'; end if;
 if coalesce(v_cfg.payment_mode,'')<>'wallet_only' then raise exception 'wallet_only_required'; end if;
 select * into v_user from public.domain_users where id=p_user_id and status='active';
 if not found then raise exception 'wallet_user_not_found'; end if;
 select * into v_order from public.domain_orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'order_not_found'; end if;
 v_env:=lower(v_order.registrar_environment);
 if v_env not in ('ote','production') then raise exception 'unsupported_registrar_environment'; end if;
 v_checkout_env:=lower(coalesce(v_cfg.customer_checkout_environment,v_cfg.registrar_environment,''));
 if v_checkout_env not in ('ote','production') then raise exception 'unsupported_checkout_environment'; end if;
 if v_env<>v_checkout_env then raise exception 'order_environment_mismatch'; end if;
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
end
$function$;

