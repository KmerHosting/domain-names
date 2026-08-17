-- Centralize Domain identity on the KmerHosting account UUID.
-- Applied to production as Supabase migration 20260817053947.

do $$
declare
  v_domain_users integer;
  v_mapped integer;
  v_email_matches integer;
  r record;
  v_delete_action text;
begin
  select count(*) into v_domain_users from public.domain_users;
  select count(*) into v_mapped
  from public.domain_users u
  join public.dashboard_product_identities i
    on i.product='domain' and i.external_user_id=u.id::text;
  select count(*) into v_email_matches
  from public.domain_users u
  join public.dashboard_product_identities i
    on i.product='domain' and i.external_user_id=u.id::text
  join public.dashboard_users d on d.id=i.user_id and lower(d.email)=lower(u.email);

  if v_domain_users <> v_mapped or v_domain_users <> v_email_matches then
    raise exception 'domain central identity preflight failed: users %, mapped %, email_matches %', v_domain_users, v_mapped, v_email_matches;
  end if;

  if exists (
    select 1
    from public.domain_users u
    join public.dashboard_product_identities i on i.product='domain' and i.external_user_id=u.id::text
    join public.domain_users collision on collision.id=i.user_id and collision.id<>u.id
  ) then
    raise exception 'domain central identity UUID collision detected';
  end if;

  alter table public.domain_users alter column password_hash drop not null;

  for r in
    select c.conname,
           c.conrelid::regclass as child_table,
           a.attname as child_column,
           c.confdeltype
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.domain_users'::regclass
  loop
    v_delete_action := case r.confdeltype
      when 'c' then 'CASCADE'
      when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT'
      when 'r' then 'RESTRICT'
      else 'NO ACTION'
    end;
    execute format('alter table %s drop constraint %I', r.child_table, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.domain_users(id) on update cascade on delete %s',
      r.child_table, r.conname, r.child_column, v_delete_action
    );
  end loop;

  perform set_config('app.dashboard_credit_sync','on',true);
  perform set_config('app.domain_wallet_write','allowed',true);

  update public.domain_users u
  set id=i.user_id,
      email=d.email,
      password_hash=null,
      full_name=coalesce(nullif(d.full_name,''),u.full_name,split_part(d.email,'@',1)),
      phone=d.phone,
      country_code=d.country_code,
      email_verified_at=coalesce(d.email_verified_at,u.email_verified_at,now()),
      session_version=u.session_version+1,
      updated_at=now()
  from public.dashboard_product_identities i
  join public.dashboard_users d on d.id=i.user_id
  where i.product='domain'
    and i.external_user_id=u.id::text
    and u.id<>i.user_id;

  update public.dashboard_product_identities i
  set external_user_id=i.user_id::text,
      external_email=d.email,
      last_seen_at=now(),
      metadata=coalesce(i.metadata,'{}'::jsonb)||jsonb_build_object('identityProtocol',2,'uuidCentralizedAt',now())
  from public.dashboard_users d
  where i.product='domain' and d.id=i.user_id;

  insert into public.domain_user_environment_balances(user_id,registrar_environment,balance_usd)
  select u.id,'production',round(coalesce(b.balance_micros,0)::numeric/10000,2)
  from public.domain_users u
  left join public.dashboard_credit_balances b on b.user_id=u.id
  on conflict (user_id,registrar_environment)
  do update set balance_usd=excluded.balance_usd,updated_at=now();

  update public.domain_users u
  set balance_usd=round(coalesce(b.balance_micros,0)::numeric/10000,2),
      password_hash=null,
      updated_at=now()
  from public.dashboard_credit_balances b
  where b.user_id=u.id;

  update public.domain_users u
  set balance_usd=0,password_hash=null,updated_at=now()
  where not exists(select 1 from public.dashboard_credit_balances b where b.user_id=u.id);

  update public.domain_sessions set revoked_at=coalesce(revoked_at,now()) where revoked_at is null;
  delete from public.domain_otp_challenges;
end $$;

alter table public.domain_users alter column id drop default;

alter table public.domain_users
  add constraint domain_users_central_account_fkey
  foreign key (id) references public.dashboard_users(id)
  on update cascade on delete restrict;

create or replace function public.domain_enforce_central_account_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_central public.dashboard_users%rowtype;
begin
  if tg_op='INSERT' then
    select * into v_central
    from public.dashboard_users
    where lower(email)=lower(new.email) and status='active'
    limit 1;
    if not found then
      raise exception 'central_account_required';
    end if;
    new.id:=v_central.id;
  else
    select * into v_central from public.dashboard_users where id=old.id;
    if not found then
      raise exception 'central_account_required';
    end if;
    new.id:=old.id;
  end if;

  new.email:=v_central.email;
  new.full_name:=coalesce(nullif(v_central.full_name,''),nullif(new.full_name,''),split_part(v_central.email,'@',1));
  new.phone:=v_central.phone;
  new.country_code:=v_central.country_code;
  new.email_verified_at:=coalesce(v_central.email_verified_at,new.email_verified_at,now());
  new.password_hash:=null;
  return new;
end;
$$;

drop trigger if exists domain_enforce_central_account_identity on public.domain_users;
create trigger domain_enforce_central_account_identity
before insert or update on public.domain_users
for each row execute function public.domain_enforce_central_account_identity();

create or replace function public.dashboard_sync_domain_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  update public.domain_users
  set email=new.email,
      full_name=coalesce(nullif(new.full_name,''),full_name),
      phone=new.phone,
      country_code=new.country_code,
      email_verified_at=coalesce(new.email_verified_at,email_verified_at),
      updated_at=now()
  where id=new.id;
  return new;
end;
$$;

drop trigger if exists dashboard_sync_domain_profile on public.dashboard_users;
create trigger dashboard_sync_domain_profile
after update of email,full_name,phone,country_code,email_verified_at on public.dashboard_users
for each row execute function public.dashboard_sync_domain_profile();
