-- Personal workspaces for the first release; no shared/team access is implied.
create table public.ad_brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kit jsonb not null check (jsonb_typeof(kit) = 'object' and octet_length(kit::text) <= 40000),
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 800000),
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create table public.ad_provider_accounts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'higgsfield-platform'),
  encrypted_key text not null check (length(encrypted_key) between 30 and 12000),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);
create index ad_brands_owner_updated on public.ad_brands(owner_id, updated_at desc);
create index ad_campaigns_owner_updated on public.ad_campaigns(owner_id, updated_at desc);

create function public.ad_touch_record() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function public.ad_touch_record() from public;
create trigger ad_brands_touch before update on public.ad_brands for each row execute function public.ad_touch_record();
create trigger ad_campaigns_touch before update on public.ad_campaigns for each row execute function public.ad_touch_record();
create trigger ad_provider_touch before update on public.ad_provider_accounts for each row execute function public.ad_touch_record();

alter table public.ad_brands enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_provider_accounts enable row level security;
revoke all on public.ad_brands, public.ad_campaigns, public.ad_provider_accounts from anon, authenticated;
grant select, insert, update, delete on public.ad_brands, public.ad_campaigns, public.ad_provider_accounts to authenticated;
create policy own_brands on public.ad_brands for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_campaigns on public.ad_campaigns for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_provider_accounts on public.ad_provider_accounts for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
