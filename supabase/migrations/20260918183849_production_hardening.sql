create schema if not exists ad_internal;
revoke all on schema ad_internal from public, anon, authenticated;
grant usage on schema ad_internal to authenticated, service_role;

alter table public.ad_generation_jobs
  add column cancel_requested_at timestamptz;

create table public.ad_account_quotas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  max_generation_jobs_per_day integer not null default 50 check (max_generation_jobs_per_day between 1 and 10000),
  max_generation_cost_cents_per_day integer not null default 5000 check (max_generation_cost_cents_per_day between 0 and 100000000),
  max_upload_bytes_per_day bigint not null default 1073741824 check (max_upload_bytes_per_day between 1 and 1099511627776),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_daily_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  generation_jobs integer not null default 0 check (generation_jobs >= 0),
  generation_cost_cents integer not null default 0 check (generation_cost_cents >= 0),
  upload_bytes bigint not null default 0 check (upload_bytes >= 0),
  primary key (owner_id, usage_date)
);

create table public.ad_rate_windows (
  owner_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('upload','generation','status','render','analytics')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (owner_id, action, window_start)
);

create table public.ad_media_objects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_bucket text not null default 'ad-media',
  storage_path text not null check (length(storage_path) between 1 and 1000),
  filename text not null check (length(filename) between 1 and 255),
  mime_type text not null check (length(mime_type) between 1 and 150),
  size_bytes bigint not null check (size_bytes > 0),
  expires_at timestamptz not null default (now() + interval '30 days'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table public.ad_audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.ad_campaigns(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (length(event_type) between 3 and 100),
  entity_type text not null check (length(entity_type) between 2 and 100),
  entity_id text not null check (length(entity_id) between 1 and 500),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index ad_media_objects_cleanup on public.ad_media_objects(expires_at) where deleted_at is null;
create index ad_media_objects_owner on public.ad_media_objects(owner_id, created_at desc);
create index ad_audit_events_owner on public.ad_audit_events(owner_id, created_at desc);
create index ad_audit_events_campaign on public.ad_audit_events(campaign_id, created_at desc);
create index ad_daily_usage_date on public.ad_daily_usage(usage_date);
create index ad_rate_windows_cleanup on public.ad_rate_windows(window_start);

alter table public.ad_account_quotas enable row level security;
alter table public.ad_daily_usage enable row level security;
alter table public.ad_rate_windows enable row level security;
alter table public.ad_media_objects enable row level security;
alter table public.ad_audit_events enable row level security;

revoke all on public.ad_account_quotas, public.ad_daily_usage, public.ad_rate_windows,
  public.ad_media_objects, public.ad_audit_events from anon, authenticated;
grant select on public.ad_account_quotas, public.ad_daily_usage, public.ad_media_objects,
  public.ad_audit_events to authenticated;
grant insert on public.ad_media_objects to authenticated;

create policy own_ad_account_quotas on public.ad_account_quotas for select to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_daily_usage on public.ad_daily_usage for select to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_media_objects on public.ad_media_objects for select to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy insert_own_ad_media_objects on public.ad_media_objects for insert to authenticated
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_audit_events on public.ad_audit_events for select to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));

create function ad_internal.consume_quota(
  p_owner uuid,
  p_action text,
  p_units bigint default 1,
  p_cost_cents integer default 0
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_quota public.ad_account_quotas%rowtype;
  v_usage public.ad_daily_usage%rowtype;
  v_window timestamptz := date_trunc('minute', now());
  v_rate integer;
  v_count integer;
begin
  if p_owner is null or p_action not in ('upload','generation','status','render','analytics')
     or p_units < 0 or p_cost_cents < 0 then
    raise exception 'Invalid quota request';
  end if;
  insert into public.ad_account_quotas(owner_id) values (p_owner)
    on conflict (owner_id) do nothing;
  select * into v_quota from public.ad_account_quotas where owner_id = p_owner for update;
  v_rate := case p_action
    when 'upload' then 20 when 'generation' then 10 when 'status' then 120
    when 'render' then 5 when 'analytics' then 10 else 1 end;
  insert into public.ad_rate_windows(owner_id, action, window_start, request_count)
    values (p_owner, p_action, v_window, 1)
    on conflict (owner_id, action, window_start) do update
      set request_count = public.ad_rate_windows.request_count + 1
    returning request_count into v_count;
  if v_count > v_rate then raise exception 'Rate limit exceeded. Try again shortly'; end if;

  insert into public.ad_daily_usage(owner_id, usage_date) values (p_owner, current_date)
    on conflict (owner_id, usage_date) do nothing;
  select * into v_usage from public.ad_daily_usage
    where owner_id = p_owner and usage_date = current_date for update;
  if p_action = 'upload' and v_usage.upload_bytes + p_units > v_quota.max_upload_bytes_per_day then
    raise exception 'Daily upload quota exceeded';
  end if;
  if p_action = 'generation' and (
    v_usage.generation_jobs + p_units > v_quota.max_generation_jobs_per_day or
    v_usage.generation_cost_cents + p_cost_cents > v_quota.max_generation_cost_cents_per_day
  ) then raise exception 'Daily generation quota exceeded'; end if;
  update public.ad_daily_usage set
    upload_bytes = upload_bytes + case when p_action = 'upload' then p_units else 0 end,
    generation_jobs = generation_jobs + case when p_action = 'generation' then p_units::integer else 0 end,
    generation_cost_cents = generation_cost_cents + case when p_action = 'generation' then p_cost_cents else 0 end
  where owner_id = p_owner and usage_date = current_date;
end;
$$;
revoke all on function ad_internal.consume_quota(uuid,text,bigint,integer) from public, anon;
grant execute on function ad_internal.consume_quota(uuid,text,bigint,integer) to authenticated, service_role;

create function public.consume_ad_quota(
  p_action text,
  p_units bigint default 1,
  p_cost_cents integer default 0
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A verified account is required';
  end if;
  perform ad_internal.consume_quota(auth.uid(), p_action, p_units, p_cost_cents);
end;
$$;
revoke all on function public.consume_ad_quota(text,bigint,integer) from public, anon;
grant execute on function public.consume_ad_quota(text,bigint,integer) to authenticated;

create function ad_internal.enforce_generation_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform ad_internal.consume_quota(new.owner_id,'generation',1,new.estimated_cost_cents);
  return new;
end;
$$;
revoke all on function ad_internal.enforce_generation_quota() from public, anon, authenticated;
create trigger ad_generation_jobs_quota before insert on public.ad_generation_jobs
for each row execute function ad_internal.enforce_generation_quota();

create function ad_internal.audit_generation_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then v_event := 'generation.queued';
  elsif new.cancel_requested_at is distinct from old.cancel_requested_at and new.cancel_requested_at is not null then
    v_event := 'generation.cancel_requested';
  elsif new.status is distinct from old.status then v_event := 'generation.' || new.status;
  else return new;
  end if;
  insert into public.ad_audit_events(owner_id,campaign_id,actor_id,event_type,entity_type,entity_id,details)
  values (new.owner_id,new.campaign_id,auth.uid(),v_event,'generation_job',new.id::text,
    jsonb_build_object('provider',new.provider,'model',new.model,'estimated_cost_cents',new.estimated_cost_cents,
      'actual_cost_cents',new.actual_cost_cents,'external_id',new.external_id,'status',new.status));
  return new;
end;
$$;
revoke all on function ad_internal.audit_generation_job() from public, anon, authenticated;

create trigger ad_generation_jobs_audit after insert or update on public.ad_generation_jobs
for each row execute function ad_internal.audit_generation_job();

create function ad_internal.audit_campaign_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.production_approved_at is distinct from old.production_approved_at
     or new.budget_cents is distinct from old.budget_cents then
    insert into public.ad_audit_events(owner_id,campaign_id,actor_id,event_type,entity_type,entity_id,details)
    values (new.owner_id,new.id,auth.uid(),'campaign.production_approval','campaign',new.id::text,
      jsonb_build_object('status',new.status,'budget_cents',new.budget_cents,
        'production_approved_at',new.production_approved_at));
  end if;
  return new;
end;
$$;
revoke all on function ad_internal.audit_campaign_approval() from public, anon, authenticated;
create trigger ad_campaigns_audit after update on public.ad_campaigns
for each row execute function ad_internal.audit_campaign_approval();

create function public.request_cancel_ad_generation_job(p_job_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_job public.ad_generation_jobs%rowtype;
begin
  if v_owner is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A verified account is required';
  end if;
  select * into v_job from public.ad_generation_jobs
    where id = p_job_id and owner_id = v_owner for update;
  if not found then raise exception 'Generation job not found'; end if;
  if v_job.status in ('succeeded','failed','canceled') then return v_job.status; end if;
  if v_job.status = 'queued' and v_job.external_id is null then
    update public.ad_generation_jobs set status='canceled',cancel_requested_at=now(),
      completed_at=now(),actual_cost_cents=0,lease_until=null where id=p_job_id;
    update public.ad_campaigns set reserved_cents=greatest(0,reserved_cents-v_job.estimated_cost_cents)
      where id=v_job.campaign_id and owner_id=v_owner;
    return 'canceled';
  end if;
  update public.ad_generation_jobs set cancel_requested_at=now() where id=p_job_id;
  return 'cancel_requested';
end;
$$;
revoke all on function public.request_cancel_ad_generation_job(uuid) from public, anon;
grant execute on function public.request_cancel_ad_generation_job(uuid) to authenticated;

alter function public.enqueue_ad_generation_job(uuid,text,text,integer,jsonb,text,text,text,jsonb,integer)
  security definer;
revoke insert, update, delete on public.ad_generation_jobs from authenticated;
grant select on public.ad_generation_jobs to authenticated;
