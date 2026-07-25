-- Enforce exactly one possible administrator account on the domain platform.
-- The application already had one admin user; this prevents a second admin role.
create unique index if not exists domain_users_single_admin_idx
on public.domain_users ((role))
where role = 'admin';

create index if not exists domain_orders_status_created_idx
on public.domain_orders (status, created_at desc);

create index if not exists domain_payments_status_created_idx
on public.domain_payments (status, created_at desc);

create index if not exists domain_jobs_status_run_after_idx
on public.domain_jobs (status, run_after);

comment on index public.domain_users_single_admin_idx is
  'Enforces a single unique admin account for the KmerHosting domain platform.';
