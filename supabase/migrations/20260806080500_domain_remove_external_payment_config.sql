begin;

alter table public.domain_config
  drop column if exists camerpay_base_url,
  drop column if exists camerpay_callback_url,
  drop column if exists camerpay_return_url;

commit;
