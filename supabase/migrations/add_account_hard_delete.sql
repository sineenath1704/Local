-- supabase/migrations/add_account_hard_delete.sql
--
-- Bypasses GoTrue's auth.admin.deleteUser(), which (in some Supabase
-- environments) returns "database error deleting user" before the
-- cascade even gets to run. The same FK chain still fires — auth.users
-- → public.users → every owned row — but with an SQL-level delete the
-- real error surfaces from Postgres instead of being masked.
--
-- Gated to service_role only; a SECURITY DEFINER bypass callable from
-- anon/authenticated would be a privilege-escalation primitive.

create or replace function public.account_hard_delete(target_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: service_role only'
      using errcode = '42501';
  end if;

  delete from auth.users where id = target_uid;
end;
$$;

revoke all on function public.account_hard_delete(uuid) from public;
grant execute on function public.account_hard_delete(uuid) to service_role;
