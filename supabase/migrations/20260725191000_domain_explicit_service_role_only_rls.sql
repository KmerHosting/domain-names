do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like 'domain\_%' escape '\'
  loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
    if not exists (
      select 1 from pg_policies
      where schemaname = r.schemaname
        and tablename = r.tablename
        and policyname = 'deny_direct_client_access'
    ) then
      execute format('create policy deny_direct_client_access on %I.%I for all to anon, authenticated using (false) with check (false)', r.schemaname, r.tablename);
    end if;
  end loop;
end $$;

-- Remove duplicate indexes reported by Supabase advisor while keeping constraints and broader existing indexes.
drop index if exists public.idx_domain_invoices_invoice_number;
drop index if exists public.idx_domain_invoices_user_issued_at;
drop index if exists public.idx_domain_payments_order_created_at;