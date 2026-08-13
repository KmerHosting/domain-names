-- DomainNameAPI reseller funds and KmerHosting customer credits are distinct concepts.
-- Provider capacity is authoritative only when read from the selected DNA API host.

comment on table public.domain_provider_balance_snapshots is
  'Read-only cache/audit of DomainNameAPI reseller account balance responses. Never a KmerHosting-created balance and never the authoritative source for order execution.';

comment on column public.domain_provider_balance_snapshots.balance is
  'Balance read from DomainNameAPI for the requested currency. For USD this is the provider usdBalance field from the selected OTE or production API host.';

comment on column public.domain_provider_balance_snapshots.provider_payload is
  'Diagnostic subset of the DomainNameAPI response. tryBalance is TRY/TL currency balance, not a test-environment balance.';

comment on table public.domain_user_environment_balances is
  'KmerHosting per-customer billing credit ledger separated by OTE/production. This is not a DomainNameAPI reseller balance.';

comment on column public.domain_user_environment_balances.balance_usd is
  'Customer credit available for KmerHosting billing in this environment; unrelated to DomainNameAPI reseller account usdBalance.';

create or replace view public.domain_dna_provider_balance_cache as
select registrar_environment as environment,
       currency,
       balance as dna_balance,
       provider_http_status,
       status,
       error_message,
       checked_at,
       'DomainNameAPI'::text as source,
       false as authoritative_for_order_execution
from public.domain_provider_latest_balances;

create or replace view public.domain_customer_credit_matrix as
select user_id,
       email,
       role,
       status,
       ote_balance_usd as ote_customer_credit_usd,
       production_balance_usd as production_customer_credit_usd,
       checkout_environment,
       checkout_balance_usd as checkout_customer_credit_usd,
       'KmerHosting customer ledger'::text as source,
       false as domainnameapi_balance
from public.domain_user_balance_matrix;

update public.domain_provider_balance_snapshots
set provider_payload = coalesce(provider_payload,'{}'::jsonb) || jsonb_build_object(
  'source','DomainNameAPI',
  'tryBalanceCurrency','TRY/TL',
  'tryBalanceIsTestBalance',false
)
where coalesce(provider_payload->>'source','') <> 'DomainNameAPI';
