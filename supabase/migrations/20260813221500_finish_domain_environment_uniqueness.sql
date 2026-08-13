-- The same domain name may exist once in OTE and once in production.
-- Composite unique indexes are already created by the environment-isolation migration.

drop index if exists public.domain_domains_domain_name_uidx;
drop index if exists public.domain_domains_name_unique;
