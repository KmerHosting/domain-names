-- Record async pg_net dispatch separately from the eventual HTTP result.
create or replace function public.domain_recorded_cron(p_job_name text, p_sql text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, net, cron, pg_temp
as $$
declare
  v_run_id uuid;
  v_started timestamptz := now();
  v_result bigint := null;
begin
  insert into public.domain_cron_runs(job_name, status, started_at, details)
  values (p_job_name, 'running', v_started, jsonb_build_object('sql', p_sql))
  returning id into v_run_id;

  execute p_sql into v_result;

  update public.domain_cron_runs
     set status = 'dispatched',
         details = coalesce(details, '{}'::jsonb) || jsonb_build_object('request_id', v_result)
   where id = v_run_id;

  return v_result;
exception when others then
  update public.domain_cron_runs
     set status = 'failed',
         finished_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - v_started)) * 1000)::int),
         error_message = sqlerrm,
         details = coalesce(details, '{}'::jsonb) || jsonb_build_object('sqlstate', sqlstate)
   where id = v_run_id;
  raise;
end;
$$;

create or replace function public.domain_reconcile_cron_http_results()
returns integer
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_count integer := 0;
begin
  with resolved as (
    select c.id,
           r.status_code,
           r.created,
           r.timed_out,
           r.error_msg,
           r.content
      from public.domain_cron_runs c
      join net._http_response r
        on r.id = (c.details->>'request_id')::bigint
     where c.status in ('dispatched','success')
       and c.details ? 'request_id'
       and c.started_at > now() - interval '7 days'
       and (c.status='dispatched' or r.status_code not between 200 and 299 or r.timed_out or r.error_msg is not null)
  ), updated as (
    update public.domain_cron_runs c
       set status = case
                      when r.timed_out or r.error_msg is not null then 'failed'
                      when r.status_code between 200 and 299 then 'success'
                      else 'failed'
                    end,
           finished_at = coalesce(r.created, now()),
           duration_ms = greatest(0, floor(extract(epoch from (coalesce(r.created,now()) - c.started_at))*1000)::int),
           error_message = case
                             when r.timed_out then 'HTTP request timed out'
                             when r.error_msg is not null then left(r.error_msg,2000)
                             when r.status_code between 200 and 299 then null
                             else left(coalesce(r.content,'HTTP request failed'),2000)
                           end,
           details = coalesce(c.details,'{}'::jsonb) || jsonb_build_object('http_status',r.status_code,'timed_out',r.timed_out)
      from resolved r
     where c.id=r.id
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

revoke execute on function public.domain_recorded_cron(text,text) from public, anon, authenticated;
revoke execute on function public.domain_reconcile_cron_http_results() from public, anon, authenticated;
grant execute on function public.domain_recorded_cron(text,text) to service_role;
grant execute on function public.domain_reconcile_cron_http_results() to service_role;

select public.domain_reconcile_cron_http_results();

do $$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname='domain-cron-http-reconcile'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
  perform cron.schedule('domain-cron-http-reconcile','* * * * *','select public.domain_reconcile_cron_http_results();');
end $$;
