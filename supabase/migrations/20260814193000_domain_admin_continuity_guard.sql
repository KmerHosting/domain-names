drop index if exists public.domain_users_single_admin_idx;

drop trigger if exists domain_users_admin_continuity_guard on public.domain_users;
drop function if exists public.domain_guard_admin_continuity();

create or replace function public.domain_prevent_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_other_admins integer;
  v_other_active_admins integer;
begin
  if old.role <> 'admin' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('domain_admin_continuity'));

  select count(*) into v_other_admins
  from public.domain_users
  where role = 'admin' and id <> old.id;

  select count(*) into v_other_active_admins
  from public.domain_users
  where role = 'admin' and status = 'active' and id <> old.id;

  if tg_op = 'DELETE' then
    if v_other_admins < 1 then
      raise exception 'The last administrator account cannot be deleted.' using errcode = '23514';
    end if;
    if old.status = 'active' and v_other_active_admins < 1 then
      raise exception 'The last active administrator account cannot be deleted.' using errcode = '23514';
    end if;
    return old;
  end if;

  if new.role is distinct from 'admin' then
    if v_other_admins < 1 then
      raise exception 'The last administrator account cannot be demoted.' using errcode = '23514';
    end if;
    if old.status = 'active' and v_other_active_admins < 1 then
      raise exception 'The last active administrator account cannot be demoted.' using errcode = '23514';
    end if;
  end if;

  if old.status = 'active' and new.status is distinct from 'active' and v_other_active_admins < 1 then
    raise exception 'The last active administrator account cannot be deactivated.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists domain_prevent_last_active_admin_update on public.domain_users;
create trigger domain_prevent_last_active_admin_update
before update of role, status or delete on public.domain_users
for each row execute function public.domain_prevent_last_active_admin();
