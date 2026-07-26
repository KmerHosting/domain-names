create or replace function public.domain_prevent_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.status = 'active' then
      if not exists (
        select 1 from public.domain_users
        where role = 'admin' and status = 'active' and id <> old.id
      ) then
        raise exception 'The last active administrator account cannot be deleted.' using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.role = 'admin' and old.status = 'active'
       and (new.role is distinct from 'admin' or new.status is distinct from 'active') then
      if not exists (
        select 1 from public.domain_users
        where role = 'admin' and status = 'active' and id <> old.id
      ) then
        raise exception 'The last active administrator account cannot be deactivated, deleted, or demoted.' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists domain_prevent_last_active_admin_update on public.domain_users;
create trigger domain_prevent_last_active_admin_update
before update or delete on public.domain_users
for each row execute function public.domain_prevent_last_active_admin();

revoke all on function public.domain_prevent_last_active_admin() from public, anon, authenticated;
