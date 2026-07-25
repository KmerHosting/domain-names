-- KmerHosting Domain Portal
-- Custom identity and domain lifecycle tables. This migration intentionally does not use auth.users.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.domain_config (
  id boolean primary key default true check (id),
  site_url text not null default 'https://domain.kmerhosting.com',
  company_name text not null default 'KmerHosting LLC',
  brand_name text not null default 'KmerHosting Domains',
  support_email text not null default 'support@kmerhosting.com',
  registrar_environment text not null default 'ote' check (registrar_environment in ('ote','production')),
  registrar_ote_base_url text not null default 'https://ote.domainresellerapi.com',
  registrar_production_base_url text not null default 'https://api.domainresellerapi.com',
  registrar_reseller_id text,
  camerpay_base_url text not null default 'https://camerpay.biz',
  payment_currency text not null default 'XAF',
  usd_to_xaf_rate numeric(12,4) not null default 600 check (usd_to_xaf_rate > 0),
  payment_sandbox boolean not null default true,
  default_nameservers text[] not null default array['tr.apiname.com','eu.apiname.com'],
  otp_ttl_minutes integer not null default 10 check (otp_ttl_minutes between 3 and 30),
  session_ttl_days integer not null default 30 check (session_ttl_days between 1 and 365),
  renewal_notice_days integer[] not null default array[60,30,14,7,3,1],
  auto_renew_charge_days integer not null default 14 check (auto_renew_charge_days between 1 and 90),
  expiry_grace_days integer not null default 30 check (expiry_grace_days between 0 and 90),
  max_job_attempts integer not null default 8 check (max_job_attempts between 1 and 20),
  maintenance_mode boolean not null default false,
  mailtrap_api_url text not null default 'https://send.api.mailtrap.io/api/send',
  mailtrap_sender_email text not null default 'support@kmerhosting.com',
  mailtrap_sender_name text not null default 'KmerHosting',
  camerpay_callback_url text not null default 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-api/webhooks/camerpay',
  camerpay_return_url text not null default 'https://domain.kmerhosting.com/payment/return',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.domain_config(id) values(true) on conflict (id) do nothing;

create table if not exists public.domain_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  full_name text not null,
  phone text,
  country_code text,
  role text not null default 'customer' check (role in ('customer','admin')),
  email_verified_at timestamptz,
  session_version integer not null default 0 check (session_version >= 0),
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email=lower(trim(email)))
);
create unique index if not exists domain_users_email_unique on public.domain_users(lower(email));

create table if not exists public.domain_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('registration','login','password_reset','email_change','account_deletion')),
  user_id uuid references public.domain_users(id) on delete cascade,
  email text not null,
  code_hash text not null,
  password_hash text,
  profile_payload jsonb not null default '{}',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  send_count integer not null default 1,
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  client_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email=lower(trim(email)))
);
create unique index if not exists domain_otp_active_email_idx on public.domain_otp_challenges(purpose,lower(email)) where consumed_at is null;
create index if not exists domain_otp_expiry_idx on public.domain_otp_challenges(expires_at) where consumed_at is null;

create table if not exists public.domain_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.domain_users(id) on delete cascade,
  token_hash text not null unique,
  session_version integer not null,
  user_agent text,
  client_ip text,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists domain_sessions_user_idx on public.domain_sessions(user_id,created_at desc);
create index if not exists domain_sessions_expiry_idx on public.domain_sessions(expires_at) where revoked_at is null;

create table if not exists public.domain_rate_limits (
  key text primary key,
  hits integer not null default 1,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.domain_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.domain_users(id) on delete cascade,
  label text not null default 'Default',
  first_name text not null,
  last_name text not null,
  company_name text,
  email text not null,
  phone_country_code text not null,
  phone text not null,
  fax_country_code text,
  fax text,
  address text not null,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null check (char_length(country)=2),
  registrar_handle text,
  registrar_verified boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email=lower(trim(email)))
);
create unique index if not exists domain_contacts_default_idx on public.domain_contacts(user_id) where is_default;

create table if not exists public.domain_tld_prices (
  tld text primary key check (left(tld,1)='.' and char_length(tld)>1),
  enabled boolean not null default true,
  popular boolean not null default false,
  registration_price_usd numeric(12,2) not null check (registration_price_usd>=0),
  renewal_price_usd numeric(12,2) not null check (renewal_price_usd>=0),
  transfer_price_usd numeric(12,2) not null check (transfer_price_usd>=0),
  registration_cost_usd numeric(12,2),
  renewal_cost_usd numeric(12,2),
  transfer_cost_usd numeric(12,2),
  min_years integer not null default 1,
  max_years integer not null default 10,
  supports_privacy boolean not null default true,
  is_promo boolean not null default false,
  price_source text not null default 'manual_seed',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.domain_tld_prices(tld,popular,registration_price_usd,renewal_price_usd,transfer_price_usd,is_promo) values
('.com',true,13.99,15.99,13.99,false),('.net',true,16.99,18.99,16.99,false),
('.org',true,12.99,14.99,12.99,false),('.co',true,29.99,32.99,29.99,false),
('.io',true,49.99,54.99,49.99,false),('.ai',true,99.99,109.99,99.99,false),
('.app',true,18.99,20.99,18.99,false),('.dev',true,18.99,20.99,18.99,false),
('.info',false,8.99,24.99,18.99,true),('.biz',false,26.99,28.99,26.99,false),
('.xyz',true,4.99,17.99,12.99,true),('.online',true,4.99,34.99,28.99,true),
('.site',true,3.99,32.99,27.99,true),('.shop',true,4.99,39.99,32.99,true),
('.store',false,5.99,49.99,39.99,true),('.tech',false,8.99,49.99,39.99,true),
('.cloud',false,14.99,24.99,20.99,false)
on conflict (tld) do nothing;

create table if not exists public.domain_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  idempotency_key text unique,
  user_id uuid not null references public.domain_users(id) on delete restrict,
  contact_id uuid references public.domain_contacts(id) on delete set null,
  domain_id uuid,
  type text not null check (type in ('registration','transfer','renewal','restore')),
  domain_name text not null,
  tld text not null references public.domain_tld_prices(tld),
  years integer not null default 1 check (years between 1 and 10),
  status text not null default 'draft' check (status in ('draft','pending_payment','payment_pending','paid','queued','processing','completed','failed','cancelled','refunded')),
  price_usd numeric(12,2) not null,
  usd_to_xaf_rate numeric(12,4) not null,
  amount_xaf integer not null,
  payment_method text,
  auth_code_ciphertext text,
  nameservers text[] not null default '{}',
  contact_snapshot jsonb not null default '{}',
  registrar_request jsonb not null default '{}',
  registrar_response jsonb not null default '{}',
  registrar_order_id text,
  failure_code text,
  failure_message text,
  paid_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (domain_name=lower(trim(domain_name)))
);

create table if not exists public.domain_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.domain_orders(id) on delete cascade,
  user_id uuid not null references public.domain_users(id) on delete restrict,
  provider text not null default 'camerpay',
  merchant_invoice_id text not null unique,
  provider_reference text,
  idempotency_key text not null unique,
  amount_xaf integer not null,
  currency text not null default 'XAF',
  payment_method text,
  status text not null default 'pending' check (status in ('pending','processing','paid','failed','cancelled','refunded')),
  checkout_url text,
  raw_payload jsonb not null default '{}',
  verified_webhook boolean not null default false,
  paid_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.domain_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.domain_users(id) on delete restrict,
  contact_id uuid references public.domain_contacts(id) on delete set null,
  domain_name text not null,
  tld text not null references public.domain_tld_prices(tld),
  registrar_domain_id text,
  registrar_order_id text,
  status text not null default 'pending' check (status in ('pending','active','transfer_pending','expired','grace','redemption','suspended','failed','cancelled')),
  epp_statuses text[] not null default '{}',
  registered_at timestamptz,
  expires_at timestamptz,
  auto_renew boolean not null default true,
  privacy_enabled boolean not null default true,
  locked boolean not null default true,
  nameservers text[] not null default '{}',
  last_synced_at timestamptz,
  next_sync_at timestamptz not null default now(),
  last_reminder_days integer,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (domain_name=lower(trim(domain_name)))
);
create unique index if not exists domain_domains_name_unique on public.domain_domains(lower(domain_name));
alter table public.domain_orders drop constraint if exists domain_orders_domain_id_fkey;
alter table public.domain_orders add constraint domain_orders_domain_id_fkey foreign key(domain_id) references public.domain_domains(id) on delete set null;

create table if not exists public.domain_dns_records (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domain_domains(id) on delete cascade,
  user_id uuid not null references public.domain_users(id) on delete cascade,
  name text not null default '@',
  type text not null check (type in ('A','AAAA','CNAME','MX','TXT','NS','SRV','CAA')),
  contents text[] not null,
  ttl integer not null default 3600 check (ttl between 1 and 86400),
  priority integer,
  status text not null default 'pending' check (status in ('pending','active','failed','deleting')),
  registrar_response jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.domain_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  user_id uuid references public.domain_users(id) on delete set null,
  order_id uuid references public.domain_orders(id) on delete cascade,
  domain_id uuid references public.domain_domains(id) on delete cascade,
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','dead')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists domain_jobs_dispatch_idx on public.domain_jobs(status,run_after) where status in ('pending','failed');

create table if not exists public.domain_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.domain_users(id) on delete set null,
  order_id uuid references public.domain_orders(id) on delete cascade,
  domain_id uuid references public.domain_domains(id) on delete cascade,
  event_key text not null unique,
  recipient_email text not null,
  recipient_name text,
  template text not null,
  subject text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.domain_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.domain_users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.domain_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null unique,
  signature text,
  verified boolean not null default false,
  payload jsonb not null default '{}',
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.domain_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  user_id uuid not null references public.domain_users(id) on delete restrict,
  order_id uuid not null unique references public.domain_orders(id) on delete restrict,
  amount_usd numeric(12,2) not null,
  amount_xaf integer not null,
  status text not null default 'paid' check (status in ('paid','refunded','void')),
  issued_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create table if not exists public.domain_audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.domain_users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  client_ip text,
  user_agent text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.domain_set_updated_at() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at=now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['domain_config','domain_users','domain_otp_challenges','domain_rate_limits','domain_contacts','domain_tld_prices','domain_orders','domain_payments','domain_domains','domain_dns_records','domain_jobs','domain_email_outbox'] loop
    execute format('drop trigger if exists %I on public.%I','trg_'||t||'_updated_at',t);
    execute format('create trigger %I before update on public.%I for each row execute function public.domain_set_updated_at()','trg_'||t||'_updated_at',t);
  end loop;
end $$;

create or replace function public.domain_secret(p_name text) returns text
language sql security definer set search_path=public,vault,pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name=p_name limit 1
$$;
revoke all on function public.domain_secret(text) from public,anon,authenticated;
grant execute on function public.domain_secret(text) to service_role;

create or replace function public.domain_runtime_status() returns jsonb
language sql security definer set search_path=public,vault,pg_temp as $$
select jsonb_build_object(
  'mailtrap',exists(select 1 from vault.decrypted_secrets where name='domain_mailtrap_token' and length(decrypted_secret)>10),
  'camerpay',exists(select 1 from vault.decrypted_secrets where name='domain_camerpay_api_token' and length(decrypted_secret)>10),
  'camerpay_webhook',exists(select 1 from vault.decrypted_secrets where name='domain_camerpay_callback_secret' and length(decrypted_secret)>10),
  'registrar_ote',exists(select 1 from vault.decrypted_secrets where name='domain_registrar_ote_api_key' and length(decrypted_secret)>10),
  'registrar_production',exists(select 1 from vault.decrypted_secrets where name='domain_registrar_api_key' and length(decrypted_secret)>10),
  'cron',exists(select 1 from vault.decrypted_secrets where name='domain_internal_cron_secret' and length(decrypted_secret)>10)
) $$;
revoke all on function public.domain_runtime_status() from public,anon,authenticated;
grant execute on function public.domain_runtime_status() to service_role;

create or replace function public.domain_enqueue_job(
  p_type text,p_idempotency_key text,p_user_id uuid default null,p_order_id uuid default null,
  p_domain_id uuid default null,p_payload jsonb default '{}',p_run_after timestamptz default now()
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_max integer;
begin
  select max_job_attempts into v_max from public.domain_config where id=true;
  insert into public.domain_jobs(type,idempotency_key,user_id,order_id,domain_id,payload,run_after,max_attempts)
  values(p_type,p_idempotency_key,p_user_id,p_order_id,p_domain_id,coalesce(p_payload,'{}'),p_run_after,coalesce(v_max,8))
  on conflict(idempotency_key) do update set run_after=least(public.domain_jobs.run_after,excluded.run_after)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.domain_enqueue_job(text,text,uuid,uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.domain_enqueue_job(text,text,uuid,uuid,uuid,jsonb,timestamptz) to service_role;

create or replace function public.domain_claim_jobs(p_worker text,p_limit integer default 10)
returns setof public.domain_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query with picked as (
    select id from public.domain_jobs
    where status in ('pending','failed') and run_after<=now() and attempts<max_attempts
      and (locked_at is null or locked_at<now()-interval '10 minutes')
    order by run_after,created_at for update skip locked limit greatest(1,least(p_limit,50))
  )
  update public.domain_jobs j set status='running',locked_at=now(),locked_by=p_worker,
    attempts=j.attempts+1,updated_at=now()
  from picked where j.id=picked.id returning j.*;
end $$;
revoke all on function public.domain_claim_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.domain_claim_jobs(text,integer) to service_role;

create or replace function public.domain_claim_emails(p_limit integer default 20)
returns setof public.domain_email_outbox language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query with picked as (
    select id from public.domain_email_outbox
    where status in ('pending','failed') and next_attempt_at<=now() and attempts<8
    order by next_attempt_at,created_at for update skip locked limit greatest(1,least(p_limit,50))
  )
  update public.domain_email_outbox e set status='sending',attempts=e.attempts+1,updated_at=now()
  from picked where e.id=picked.id returning e.*;
end $$;
revoke all on function public.domain_claim_emails(integer) from public,anon,authenticated;
grant execute on function public.domain_claim_emails(integer) to service_role;

do $$ declare t text; begin
  foreach t in array array['domain_config','domain_users','domain_otp_challenges','domain_sessions','domain_rate_limits','domain_contacts','domain_tld_prices','domain_orders','domain_payments','domain_domains','domain_dns_records','domain_jobs','domain_email_outbox','domain_notifications','domain_webhook_events','domain_invoices','domain_audit_logs'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

revoke all on table public.domain_config,public.domain_users,public.domain_otp_challenges,public.domain_sessions,
 public.domain_rate_limits,public.domain_contacts,public.domain_tld_prices,public.domain_orders,public.domain_payments,
 public.domain_domains,public.domain_dns_records,public.domain_jobs,public.domain_email_outbox,public.domain_notifications,
 public.domain_webhook_events,public.domain_invoices,public.domain_audit_logs from anon,authenticated;
grant select on public.domain_tld_prices to anon,authenticated;
drop policy if exists domain_public_prices_read on public.domain_tld_prices;
create policy domain_public_prices_read on public.domain_tld_prices for select to anon,authenticated using (enabled=true);

-- Cover all domain portal foreign keys used by lifecycle and dashboard queries.
create index if not exists domain_otp_user_idx on public.domain_otp_challenges(user_id) where user_id is not null;
create index if not exists domain_orders_contact_idx on public.domain_orders(contact_id) where contact_id is not null;
create index if not exists domain_orders_domain_idx on public.domain_orders(domain_id) where domain_id is not null;
create index if not exists domain_orders_tld_idx on public.domain_orders(tld);
create index if not exists domain_payments_user_idx on public.domain_payments(user_id, created_at desc);
create index if not exists domain_domains_contact_idx on public.domain_domains(contact_id) where contact_id is not null;
create index if not exists domain_domains_tld_idx on public.domain_domains(tld);
create index if not exists domain_dns_records_user_idx on public.domain_dns_records(user_id, created_at desc);
create index if not exists domain_jobs_user_idx on public.domain_jobs(user_id, created_at desc) where user_id is not null;
create index if not exists domain_jobs_order_idx on public.domain_jobs(order_id, created_at desc) where order_id is not null;
create index if not exists domain_jobs_domain_idx on public.domain_jobs(domain_id, created_at desc) where domain_id is not null;
create index if not exists domain_email_user_idx on public.domain_email_outbox(user_id, created_at desc) where user_id is not null;
create index if not exists domain_email_order_idx on public.domain_email_outbox(order_id, created_at desc) where order_id is not null;
create index if not exists domain_email_domain_idx on public.domain_email_outbox(domain_id, created_at desc) where domain_id is not null;
create index if not exists domain_invoices_user_idx on public.domain_invoices(user_id, issued_at desc);
