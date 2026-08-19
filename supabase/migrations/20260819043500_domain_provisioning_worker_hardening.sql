-- Repair the paid-order provisioning path and make registrar access safe under
-- DomainNameAPI's one-request-per-second API-key limit.

-- domain_recorded_cron() records a running row before executing the command.
alter table public.domain_cron_runs
  drop constraint if exists domain_cron_runs_status_check;
alter table public.domain_cron_runs
  add constraint domain_cron_runs_status_check
  check (status = any (array['running'::text, 'success'::text, 'failed'::text]));

-- domain-jobs-v2 upserts with onConflict="domain_name,registrar_environment".
-- domain_name is already constrained to normalized lowercase, so expose the
-- equivalent plain-column unique index PostgREST requires for ON CONFLICT.
create unique index if not exists domain_domains_domain_name_environment_uidx
  on public.domain_domains(domain_name, registrar_environment);

create table if not exists public.domain_registrar_rate_limit_state (
  environment text primary key check (environment in ('ote', 'production')),
  last_request_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.domain_registrar_rate_limit_state(environment)
values ('ote'), ('production')
on conflict (environment) do nothing;

alter table public.domain_registrar_rate_limit_state enable row level security;
revoke all on public.domain_registrar_rate_limit_state from anon, authenticated;

create or replace function public.domain_wait_registrar_rate_limit(p_environment text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_environment text := lower(trim(coalesce(p_environment, '')));
  v_last timestamptz;
  v_elapsed double precision;
  v_wait double precision;
begin
  if v_environment not in ('ote', 'production') then
    raise exception 'Invalid registrar environment';
  end if;

  -- Serialize all calls that share one environment/API key and keep request
  -- start times at least 1.1 seconds apart.
  perform pg_advisory_xact_lock(hashtext('domain-registrar-rate:' || v_environment));

  select last_request_at into v_last
  from public.domain_registrar_rate_limit_state
  where environment = v_environment
  for update;

  if not found then
    insert into public.domain_registrar_rate_limit_state(environment)
    values (v_environment)
    on conflict (environment) do nothing;

    select last_request_at into v_last
    from public.domain_registrar_rate_limit_state
    where environment = v_environment
    for update;
  end if;

  if v_last is not null then
    v_elapsed := extract(epoch from (clock_timestamp() - v_last));
    v_wait := 1.10 - v_elapsed;
    if v_wait > 0 then
      perform pg_sleep(v_wait);
    end if;
  end if;

  update public.domain_registrar_rate_limit_state
  set last_request_at = clock_timestamp(), updated_at = now()
  where environment = v_environment;
end;
$$;

revoke all on function public.domain_wait_registrar_rate_limit(text) from public;

-- A registrar 429 means the write was rejected before acceptance. Restore the
-- wallet-paid order to its retryable state instead of leaving it processing.
create or replace function public.domain_reopen_rate_limited_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.order_id is not null
     and new.status = 'failed'
     and coalesce(new.last_error, '') ~ '\(429\)'
  then
    update public.domain_orders
       set status = 'paid',
           failure_code = null,
           failure_message = null,
           updated_at = now()
     where id = new.order_id
       and status = 'processing'
       and payment_method = 'wallet';
  end if;
  return new;
end;
$$;

drop trigger if exists domain_jobs_reopen_rate_limited_order on public.domain_jobs;
create trigger domain_jobs_reopen_rate_limited_order
after insert or update of status, last_error on public.domain_jobs
for each row execute function public.domain_reopen_rate_limited_order();

-- Central registrar proxy: retain strict environment isolation, serialize API
-- calls, and allow enough time for registration/renewal writes to complete.
create or replace function public.domain_registrar_proxy_env(
  p_path text,
  p_method text default 'GET',
  p_body jsonb default null,
  p_query jsonb default '{}'::jsonb,
  p_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
set statement_timeout = '45s'
as $$
declare
  v_environment text := lower(coalesce(nullif(trim(p_environment), ''), ''));
  v_base_url text;
  v_reseller_id text;
  v_api_key text;
  v_secret_name text;
  v_method text := upper(coalesce(p_method, 'GET'));
  v_url text;
  v_response extensions.http_response;
  v_payload jsonb;
  v_headers extensions.http_header[];
begin
  if p_path is null or p_path !~ '^/api/v1/[A-Za-z0-9_./-]+$' or p_path like '%..%' then
    raise exception 'Invalid registrar API path';
  end if;
  if v_method not in ('GET', 'POST', 'PUT', 'DELETE') then
    raise exception 'Unsupported registrar HTTP method';
  end if;

  select registrar_reseller_id into v_reseller_id
  from public.domain_config
  where id = true;

  if v_environment not in ('ote', 'production') then
    select registrar_environment into v_environment
    from public.domain_config
    where id = true;
    v_environment := case when v_environment = 'production' then 'production' else 'ote' end;
  end if;

  perform public.domain_assert_registrar_request_environment(
    coalesce(p_body, '{}'::jsonb),
    coalesce(p_query, '{}'::jsonb),
    v_environment
  );

  v_base_url := case when v_environment = 'production'
    then 'https://api.domainresellerapi.com'
    else 'https://ote.domainresellerapi.com'
  end;

  if nullif(trim(v_reseller_id), '') is null then
    raise exception 'Registrar reseller ID is not configured';
  end if;

  v_secret_name := case when v_environment = 'production'
    then 'domain_registrar_api_key'
    else 'domain_registrar_ote_api_key'
  end;
  v_api_key := public.domain_secret(v_secret_name);
  if nullif(trim(v_api_key), '') is null then
    raise exception 'Registrar API key is not configured';
  end if;

  v_url := v_base_url || p_path;
  if p_query is not null and p_query <> '{}'::jsonb then
    v_url := v_url || '?' || extensions.urlencode(p_query);
  end if;

  v_headers := array[
    extensions.http_header('Accept', 'application/json'),
    extensions.http_header('Content-Type', 'application/json'),
    extensions.http_header('__reseller', v_reseller_id),
    extensions.http_header('X-API-KEY', v_api_key)
  ]::extensions.http_header[];

  perform public.domain_wait_registrar_rate_limit(v_environment);
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '3500');
  perform extensions.http_set_curlopt(
    'CURLOPT_TIMEOUT_MS',
    case when v_method = 'GET' then '15000' else '30000' end
  );

  v_response := extensions.http((
    v_method::extensions.http_method,
    v_url::varchar,
    v_headers,
    'application/json'::varchar,
    case when p_body is null then null else p_body::text::varchar end
  )::extensions.http_request);

  perform extensions.http_reset_curlopt();

  begin
    v_payload := coalesce(nullif(v_response.content, ''), '{}')::jsonb;
  exception when others then
    v_payload := jsonb_build_object('raw', left(coalesce(v_response.content, ''), 4000));
  end;

  return jsonb_build_object(
    'status', v_response.status,
    'contentType', v_response.content_type,
    'environment', v_environment,
    'body', v_payload
  );
exception when others then
  perform extensions.http_reset_curlopt();
  raise;
end;
$$;
