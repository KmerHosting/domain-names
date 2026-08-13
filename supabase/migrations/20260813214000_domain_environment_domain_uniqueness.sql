create unique index if not exists domain_domains_name_environment_uidx
on public.domain_domains (lower(domain_name), registrar_environment);

create unique index if not exists domain_domains_domain_environment_uidx
on public.domain_domains (domain_name, registrar_environment);
