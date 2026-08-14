create or replace function public.domain_set_checkout_environment(p_environment text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_env text := lower(trim(coalesce(p_environment, '')));
begin
  if v_env not in ('ote', 'production') then
    raise exception 'invalid_registrar_environment';
  end if;

  if not exists (
    select 1
    from public.domain_provider_environments
    where environment = v_env
      and enabled
  ) then
    raise exception 'registrar_environment_disabled';
  end if;

  -- Switch the single checkout flag in two targeted updates. This satisfies
  -- safe-update protection and avoids a transient violation of the partial
  -- unique index that allows only one checkout environment at a time.
  update public.domain_provider_environments
  set customer_checkout_enabled = false,
      updated_at = now()
  where customer_checkout_enabled = true
    and environment <> v_env;

  update public.domain_provider_environments
  set customer_checkout_enabled = true,
      updated_at = now()
  where environment = v_env
    and customer_checkout_enabled is distinct from true;

  update public.domain_config
  set customer_checkout_environment = v_env,
      registrar_environment = v_env,
      updated_at = now()
  where id = true;

  -- balance_usd is the current-environment compatibility balance. Preserve the
  -- per-environment balances as source of truth and only mirror the selected one.
  perform set_config('app.domain_wallet_write', 'allowed', true);

  update public.domain_users u
  set balance_usd = coalesce((
        select b.balance_usd
        from public.domain_user_environment_balances b
        where b.user_id = u.id
          and b.registrar_environment = v_env
      ), 0),
      updated_at = now()
  where u.id is not null;

  return jsonb_build_object(
    'customerCheckoutEnvironment', v_env,
    'testMode', v_env = 'ote'
  );
end;
$$;
