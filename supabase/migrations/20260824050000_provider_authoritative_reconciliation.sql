create table if not exists public.domain_provider_inventory (
  id uuid primary key default gen_random_uuid(),
  registrar_environment text not null check (registrar_environment in ('ote','production')),
  domain_name text not null,
  provider_status text,
  registrar_domain_id text,
  registered_at timestamptz,
  expires_at timestamptz,
  nameservers text[] not null default '{}',
  locked boolean,
  privacy_enabled boolean,
  provider_payload jsonb not null default '{}'::jsonb,
  present_at_provider boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registrar_environment, domain_name)
);

comment on table public.domain_provider_inventory is
  'Service-role-only mirror of the authoritative DomainNameAPI OTE and production portfolios. It does not assign provider-only domains to customers.';

create index if not exists domain_provider_inventory_present_idx
  on public.domain_provider_inventory (registrar_environment, present_at_provider, domain_name);

alter table public.domain_provider_inventory enable row level security;
revoke all on table public.domain_provider_inventory from public, anon, authenticated;
grant select, insert, update, delete on table public.domain_provider_inventory to service_role;

comment on table public.domain_domains is
  'Customer-owned domain projection. Active status requires confirmation from the matching DomainNameAPI environment.';
