-- A live worker must never try to claim jobs from a different registrar environment.
create or replace function public.domain_claim_jobs(p_worker text, p_limit integer default 10)
returns setof public.domain_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select id
    from public.domain_jobs
    where status in ('pending','failed')
      and registrar_environment = public.domain_current_registrar_environment()
      and run_after <= now()
      and attempts < max_attempts
      and (locked_at is null or locked_at < now() - interval '10 minutes')
    order by run_after, created_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  )
  update public.domain_jobs j
     set status='running', locked_at=now(), locked_by=p_worker,
         attempts=j.attempts+1, updated_at=now()
    from picked
   where j.id=picked.id
  returning j.*;
end
$$;

revoke execute on function public.domain_claim_jobs(text,integer) from public, anon, authenticated;
grant execute on function public.domain_claim_jobs(text,integer) to service_role;

-- Retire failed OTE-only jobs left behind by the production cutover. Their orders remain as audit history.
delete from public.domain_jobs j
using public.domain_orders o
where j.order_id=o.id
  and j.registrar_environment='ote'
  and o.registrar_environment='ote'
  and o.payment_method='ote_test'
  and j.status='failed';
