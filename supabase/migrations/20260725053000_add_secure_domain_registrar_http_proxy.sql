create extension if not exists http with schema extensions;

create or replace function public.domain_registrar_proxy(
  p_path text,
  p_method text default 'GET',
  p_body jsonb default null,
  p_query jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
declare
  v_environment text;
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
  if p_path is null
     or p_path !~ '^/api/v1/[A-Za-z0-9_./-]+$'
     or p_path like '%..%'
  then
    raise exception 'Invalid registrar API path';
  end if;

  if v_method not in ('GET', 'POST', 'PUT', 'DELETE') then
    raise exception 'Unsupported registrar HTTP method';
  end if;

  select registrar_environment, registrar_reseller_id
  into v_environment, v_reseller_id
  from public.domain_config
  where id = true;

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

  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '5000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '25000');

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
    'body', v_payload
  );
exception when others then
  perform extensions.http_reset_curlopt();
  raise;
end;
$$;

revoke all on function public.domain_registrar_proxy(text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.domain_registrar_proxy(text, text, jsonb, jsonb)
  to service_role;

update public.domain_config
set registrar_ote_base_url = 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-registrar-proxy',
    registrar_production_base_url = 'https://igihzeyfgwhnuiflamvn.supabase.co/functions/v1/domain-registrar-proxy',
    updated_at = now()
where id = true;
