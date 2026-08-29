-- Domain worker helpers are internal service operations. Keep the trigger
-- callable by PostgreSQL itself and the claim function callable by backend
-- workers, but remove direct PostgREST execution from browser roles.
revoke execute on function public.dashboard_domain_claim_queued_job(uuid)
  from public, anon, authenticated;
grant execute on function public.dashboard_domain_claim_queued_job(uuid)
  to service_role;

revoke execute on function public.dashboard_queue_included_spaceship_domain_renewal_from_hosting_()
  from public, anon, authenticated;
grant execute on function public.dashboard_queue_included_spaceship_domain_renewal_from_hosting_()
  to service_role;
