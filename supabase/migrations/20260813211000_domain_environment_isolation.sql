-- Separate DomainNameAPI TEST / OTE and LIVE / production state.

create table if not exists public.domain_provider_environments (
  environment text primary key check (environment in ('ote','production')),
  display_name text not null,
  is_test boolean not null,
  api_base_url text not null,
  credential_secret_name text not null,
  enabled boolean not null default true,
  customer_checkout_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.domain_provider_environments(environment,display_name,is_test,api_base_url,credential_secret_name,enabled,customer_checkout_enabled)
values
('ote','TEST / OTE',true,'https://ote.domainresellerapi.com','domain_registrar_ote_api_key',true,false),
('production','LIVE / Production',false,'https://api.domainresellerapi.com','domain_registrar_api_key',true,false)
on conflict(environment) do update set display_name=excluded.display_name,is_test=excluded.is_test,api_base_url=excluded.api_base_url,credential_secret_name=excluded.credential_secret_name,updated_at=now();

alter table public.domain_config add column if not exists customer_checkout_environment text;
update public.domain_config set customer_checkout_environment=case when registrar_environment='production' then 'production' else 'ote' end where customer_checkout_environment is null;
alter table public.domain_config alter column customer_checkout_environment set default 'ote';
alter table public.domain_config alter column customer_checkout_environment set not null;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='domain_config_checkout_environment_check') then
    alter table public.domain_config add constraint domain_config_checkout_environment_check check(customer_checkout_environment in ('ote','production'));
  end if;
end $$;

update public.domain_provider_environments e
set customer_checkout_enabled=(e.environment=(select customer_checkout_environment from public.domain_config where id=true)),updated_at=now();

create unique index if not exists domain_provider_one_checkout_environment
on public.domain_provider_environments ((customer_checkout_enabled)) where customer_checkout_enabled;

create or replace function public.domain_current_registrar_environment()
returns text language sql security definer set search_path='public','pg_temp' as $$
  select case when coalesce(customer_checkout_environment,registrar_environment)='production' then 'production' else 'ote' end
  from public.domain_config where id=true
$$;

create table if not exists public.domain_user_environment_balances (
  user_id uuid not null references public.domain_users(id) on delete cascade,
  registrar_environment text not null check(registrar_environment in ('ote','production')),
  balance_usd numeric(12,2) not null default 0 check(balance_usd>=0),
  updated_at timestamptz not null default now(),
  primary key(user_id,registrar_environment)
);

insert into public.domain_user_environment_balances(user_id,registrar_environment,balance_usd)
select u.id,e.environment,case when e.environment=public.domain_current_registrar_environment() then coalesce(u.balance_usd,0) else 0 end
from public.domain_users u cross join (values('ote'),('production')) e(environment)
on conflict(user_id,registrar_environment) do nothing;

create or replace view public.domain_user_balance_matrix as
select u.id user_id,u.email,u.role,u.status,
       coalesce(o.balance_usd,0)::numeric(12,2) ote_balance_usd,
       coalesce(p.balance_usd,0)::numeric(12,2) production_balance_usd,
       public.domain_current_registrar_environment() checkout_environment,
       case when public.domain_current_registrar_environment()='production' then coalesce(p.balance_usd,0) else coalesce(o.balance_usd,0) end::numeric(12,2) checkout_balance_usd
from public.domain_users u
left join public.domain_user_environment_balances o on o.user_id=u.id and o.registrar_environment='ote'
left join public.domain_user_environment_balances p on p.user_id=u.id and p.registrar_environment='production';

alter table public.domain_jobs add column if not exists registrar_environment text;
alter table public.domain_provider_sync_logs add column if not exists registrar_environment text;
alter table public.domain_forwarding_rules add column if not exists registrar_environment text;
alter table public.domain_glue_hosts add column if not exists registrar_environment text;
alter table public.domain_payments add column if not exists registrar_environment text;
alter table public.domain_wallet_transactions add column if not exists registrar_environment text;
alter table public.domain_invoices add column if not exists registrar_environment text;

update public.domain_jobs j set registrar_environment=coalesce((select o.registrar_environment from public.domain_orders o where o.id=j.order_id),(select d.registrar_environment from public.domain_domains d where d.id=j.domain_id),nullif(j.payload->>'registrarEnvironment',''),public.domain_current_registrar_environment()) where registrar_environment is null;
update public.domain_provider_sync_logs set registrar_environment=case when lower(coalesce(payload->>'environment',''))='production' then 'production' when lower(coalesce(payload->>'environment','')) in ('ote','test') then 'ote' else public.domain_current_registrar_environment() end where registrar_environment is null;
update public.domain_forwarding_rules f set registrar_environment=(select d.registrar_environment from public.domain_domains d where d.id=f.domain_id) where registrar_environment is null;
update public.domain_glue_hosts g set registrar_environment=(select d.registrar_environment from public.domain_domains d where d.id=g.domain_id) where registrar_environment is null;
update public.domain_payments p set registrar_environment=coalesce((select o.registrar_environment from public.domain_orders o where o.id=p.order_id),public.domain_current_registrar_environment()) where registrar_environment is null;
update public.domain_wallet_transactions t set registrar_environment=case when lower(coalesce(t.metadata->>'registrarEnvironment',''))='production' then 'production' when lower(coalesce(t.metadata->>'registrarEnvironment','')) in ('ote','test') then 'ote' else public.domain_current_registrar_environment() end where registrar_environment is null;
update public.domain_invoices i set registrar_environment=coalesce((select o.registrar_environment from public.domain_orders o where o.id=i.order_id),public.domain_current_registrar_environment()) where registrar_environment is null;

alter table public.domain_jobs alter column registrar_environment set default public.domain_current_registrar_environment();
alter table public.domain_provider_sync_logs alter column registrar_environment set default public.domain_current_registrar_environment();
alter table public.domain_forwarding_rules alter column registrar_environment set default public.domain_current_registrar_environment();
alter table public.domain_glue_hosts alter column registrar_environment set default public.domain_current_registrar_environment();
alter table public.domain_payments alter column registrar_environment set default public.domain_current_registrar_environment();
alter table public.domain_wallet_transactions alter column registrar_environment set default public.domain_current_registrar_environment();
alter table public.domain_invoices alter column registrar_environment set default public.domain_current_registrar_environment();

alter table public.domain_jobs alter column registrar_environment set not null;
alter table public.domain_provider_sync_logs alter column registrar_environment set not null;
alter table public.domain_forwarding_rules alter column registrar_environment set not null;
alter table public.domain_glue_hosts alter column registrar_environment set not null;
alter table public.domain_payments alter column registrar_environment set not null;
alter table public.domain_wallet_transactions alter column registrar_environment set not null;
alter table public.domain_invoices alter column registrar_environment set not null;

do $$ declare t text; begin
  foreach t in array array['domain_jobs','domain_provider_sync_logs','domain_forwarding_rules','domain_glue_hosts','domain_payments','domain_wallet_transactions','domain_invoices'] loop
    if not exists(select 1 from pg_constraint where conname=t||'_registrar_environment_check') then
      execute format('alter table public.%I add constraint %I check (registrar_environment in (''ote'',''production''))',t,t||'_registrar_environment_check');
    end if;
  end loop;
end $$;

create or replace function public.domain_guard_immutable_registrar_environment()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
begin
  if tg_op='UPDATE' and new.registrar_environment is distinct from old.registrar_environment then raise exception 'registrar_environment_is_immutable'; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['domain_domains','domain_orders','domain_provider_quotes','domain_dns_records','domain_jobs','domain_provider_sync_logs','domain_forwarding_rules','domain_glue_hosts','domain_payments','domain_wallet_transactions','domain_invoices'] loop
    execute format('drop trigger if exists %I on public.%I','domain_immutable_environment_'||t,t);
    execute format('create trigger %I before update of registrar_environment on public.%I for each row execute function public.domain_guard_immutable_registrar_environment()','domain_immutable_environment_'||t,t);
  end loop;
end $$;

create or replace function public.domain_fill_child_registrar_environment()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
declare v_env text;
begin
  if tg_table_name='domain_jobs' then
    if new.order_id is not null then select registrar_environment into v_env from public.domain_orders where id=new.order_id; end if;
    if v_env is null and new.domain_id is not null then select registrar_environment into v_env from public.domain_domains where id=new.domain_id; end if;
  elsif tg_table_name in ('domain_forwarding_rules','domain_glue_hosts') then select registrar_environment into v_env from public.domain_domains where id=new.domain_id;
  elsif tg_table_name in ('domain_payments','domain_invoices') then select registrar_environment into v_env from public.domain_orders where id=new.order_id;
  end if;
  if v_env is not null then new.registrar_environment:=v_env; end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['domain_jobs','domain_forwarding_rules','domain_glue_hosts','domain_payments','domain_invoices'] loop
    execute format('drop trigger if exists %I on public.%I','domain_fill_environment_'||t,t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.domain_fill_child_registrar_environment()','domain_fill_environment_'||t,t);
  end loop;
end $$;

create or replace function public.domain_enqueue_job(p_type text,p_idempotency_key text,p_user_id uuid default null,p_order_id uuid default null,p_domain_id uuid default null,p_payload jsonb default '{}'::jsonb,p_run_after timestamptz default now())
returns uuid language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_id uuid; v_max integer; v_env text;
begin
  select max_job_attempts into v_max from public.domain_config where id=true;
  if p_order_id is not null then select registrar_environment into v_env from public.domain_orders where id=p_order_id; end if;
  if v_env is null and p_domain_id is not null then select registrar_environment into v_env from public.domain_domains where id=p_domain_id; end if;
  if v_env is null then v_env:=case when lower(coalesce(p_payload->>'registrarEnvironment',''))='production' then 'production' when lower(coalesce(p_payload->>'registrarEnvironment','')) in ('ote','test') then 'ote' else public.domain_current_registrar_environment() end; end if;
  insert into public.domain_jobs(type,idempotency_key,user_id,order_id,domain_id,payload,run_after,max_attempts,registrar_environment)
  values(p_type,p_idempotency_key,p_user_id,p_order_id,p_domain_id,coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('registrarEnvironment',v_env,'testMode',v_env='ote'),p_run_after,coalesce(v_max,8),v_env)
  on conflict(idempotency_key) do update set run_after=least(public.domain_jobs.run_after,excluded.run_after)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.domain_environment_wallet_balance(p_user_id uuid,p_environment text)
returns numeric language sql security definer set search_path='public','pg_temp' as $$
  select coalesce((select balance_usd from public.domain_user_environment_balances where user_id=p_user_id and registrar_environment=case when lower(p_environment)='production' then 'production' else 'ote' end),0)::numeric(12,2)
$$;
revoke all on function public.domain_environment_wallet_balance(uuid,text) from public,anon,authenticated;

create or replace function public.domain_manual_wallet_credit_env(p_admin_id uuid,p_user_id uuid,p_environment text,p_amount_usd numeric,p_reason text default 'Manual support credit',p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_admin public.domain_users%rowtype; v_amount numeric(12,2); v_env text; v_new numeric(12,2); v_key text; v_tx uuid; v_ref text; v_existing public.domain_wallet_transactions%rowtype;
begin
  select * into v_admin from public.domain_users where id=p_admin_id and role='admin' and status='active'; if not found then raise exception 'admin_required'; end if;
  v_env:=case when lower(trim(coalesce(p_environment,'')))='production' then 'production' when lower(trim(coalesce(p_environment,''))) in ('ote','test') then 'ote' else null end; if v_env is null then raise exception 'invalid_registrar_environment'; end if;
  v_amount:=round(coalesce(p_amount_usd,0)::numeric,2); if v_amount<=0 or v_amount>100000 then raise exception 'invalid_credit_amount'; end if;
  if not exists(select 1 from public.domain_users where id=p_user_id and status<>'deleted') then raise exception 'wallet_user_not_found'; end if;
  insert into public.domain_user_environment_balances(user_id,registrar_environment,balance_usd) values(p_user_id,v_env,0) on conflict do nothing;
  v_key:=coalesce(nullif(trim(coalesce(p_idempotency_key,'')),''),'manual-support-credit:'||v_env||':'||p_user_id::text||':'||md5(clock_timestamp()::text||random()::text));
  select * into v_existing from public.domain_wallet_transactions where idempotency_key=v_key limit 1; if found then return jsonb_build_object('credited',false,'alreadyCredited',true,'transactionId',v_existing.id,'balanceUsd',v_existing.balance_after_usd,'registrarEnvironment',v_env,'testMode',v_env='ote'); end if;
  update public.domain_user_environment_balances set balance_usd=round((balance_usd+v_amount)::numeric,2),updated_at=now() where user_id=p_user_id and registrar_environment=v_env returning balance_usd into v_new;
  v_ref:=case when v_env='ote' then 'KHD-OTE-SUPPORT-' else 'KHD-SUPPORT-' end||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(v_key),1,8));
  insert into public.domain_wallet_transactions(user_id,transaction_type,amount_usd,balance_after_usd,reference,idempotency_key,metadata,registrar_environment)
  values(p_user_id,'manual_credit',v_amount,v_new,v_ref,v_key,jsonb_build_object('adminId',v_admin.id,'reason',left(coalesce(nullif(trim(p_reason),''),'Manual support credit'),500),'source','support','registrarEnvironment',v_env,'testMode',v_env='ote'),v_env) returning id into v_tx;
  insert into public.domain_notifications(user_id,type,title,message,data) values(p_user_id,'wallet_manual_credit',case when v_env='ote' then '[TEST] Balance credited' else 'Balance credited' end,case when v_env='ote' then '[TEST] ' else '' end||'Support credited $'||to_char(v_amount,'FM999999990.00')||' to your '||upper(v_env)||' balance.',jsonb_build_object('transactionId',v_tx,'amountUsd',v_amount,'balanceUsd',v_new,'registrarEnvironment',v_env,'testMode',v_env='ote'));
  insert into public.domain_audit_logs(user_id,action,entity_type,entity_id,metadata) values(v_admin.id,'admin.wallet.manual_credit','user',p_user_id,jsonb_build_object('transactionId',v_tx,'amountUsd',v_amount,'balanceUsd',v_new,'reason',p_reason,'registrarEnvironment',v_env));
  if v_env=public.domain_current_registrar_environment() then perform set_config('app.domain_wallet_write','allowed',true); update public.domain_users set balance_usd=v_new,updated_at=now() where id=p_user_id; end if;
  return jsonb_build_object('credited',true,'transactionId',v_tx,'reference',v_ref,'amountUsd',v_amount,'balanceUsd',v_new,'registrarEnvironment',v_env,'testMode',v_env='ote');
end $$;
revoke all on function public.domain_manual_wallet_credit_env(uuid,uuid,text,numeric,text,text) from public,anon,authenticated;

create table if not exists public.domain_provider_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  registrar_environment text not null check(registrar_environment in ('ote','production')),
  currency text not null,
  balance numeric(14,2),
  provider_http_status integer,
  provider_payload jsonb not null default '{}'::jsonb,
  status text not null default 'success',
  error_message text,
  checked_at timestamptz not null default now()
);
create index if not exists domain_provider_balance_snapshots_env_checked on public.domain_provider_balance_snapshots(registrar_environment,currency,checked_at desc);
create or replace view public.domain_provider_latest_balances as
select distinct on(registrar_environment,currency) registrar_environment,currency,balance,provider_http_status,status,error_message,checked_at
from public.domain_provider_balance_snapshots order by registrar_environment,currency,checked_at desc;

create or replace view public.domain_environment_summary as
select e.environment,e.display_name,e.is_test,e.enabled,e.customer_checkout_enabled,
 (select count(*) from public.domain_domains d where d.registrar_environment=e.environment) domains,
 (select count(*) from public.domain_orders o where o.registrar_environment=e.environment) orders,
 (select count(*) from public.domain_jobs j where j.registrar_environment=e.environment and j.status in ('pending','running','failed','dead')) open_jobs,
 (select count(*) from public.domain_dns_records r where r.registrar_environment=e.environment) dns_records,
 (select balance from public.domain_provider_latest_balances b where b.registrar_environment=e.environment and b.currency='USD') provider_balance_usd,
 (select checked_at from public.domain_provider_latest_balances b where b.registrar_environment=e.environment and b.currency='USD') provider_balance_checked_at
from public.domain_provider_environments e order by e.is_test desc;
