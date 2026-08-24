-- Allow only the two direct checkout records. External checkout URLs remain forbidden.
create or replace function public.domain_reject_non_wallet_payment_write()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.checkout_url is not null then raise exception 'external_payment_providers_removed'; end if;
  if coalesce(new.provider,'') not in ('domainnameapi_ote','kmerhosting_central') then
    raise exception 'legacy_domain_payment_provider_removed';
  end if;
  if new.provider='domainnameapi_ote' and coalesce(new.payment_method,'')<>'ote_test' then
    raise exception 'invalid_ote_payment_method';
  end if;
  if new.provider='kmerhosting_central' and coalesce(new.payment_method,'')<>'central_credit' then
    raise exception 'invalid_central_payment_method';
  end if;
  return new;
end
$function$;
