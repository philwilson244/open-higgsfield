alter table public.ad_provider_accounts
  drop constraint if exists ad_provider_accounts_provider_check;
alter table public.ad_provider_accounts
  add constraint ad_provider_accounts_provider_check
  check (provider ~ '^[a-z0-9][a-z0-9._-]{1,63}$');

alter table public.ad_campaigns
  add column budget_cents integer not null default 0 check (budget_cents >= 0),
  add column reserved_cents integer not null default 0 check (reserved_cents >= 0),
  add column spent_cents integer not null default 0 check (spent_cents >= 0),
  add column production_approved_at timestamptz,
  add constraint ad_campaign_budget_check
    check (reserved_cents + spent_cents <= budget_cents);

create function public.ad_touch_campaign() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  if new.name is distinct from old.name
     or new.status is distinct from old.status
     or new.plan is distinct from old.plan
     or new.budget_cents is distinct from old.budget_cents
     or new.production_approved_at is distinct from old.production_approved_at then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.ad_touch_campaign() from public;
drop trigger ad_campaigns_touch on public.ad_campaigns;
create trigger ad_campaigns_touch before update on public.ad_campaigns
  for each row execute function public.ad_touch_campaign();

create table public.ad_shots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  variant_id text not null check (length(variant_id) between 1 and 150),
  beat_id text not null check (length(beat_id) between 1 and 150),
  position integer not null check (position between 0 and 100),
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and octet_length(spec::text) <= 100000),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, variant_id, beat_id)
);

create table public.ad_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  shot_id uuid not null references public.ad_shots(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  model text not null check (length(model) between 1 and 100),
  status text not null default 'queued'
    check (status in ('queued','processing','succeeded','failed','canceled')),
  prompt text not null check (length(prompt) between 1 and 15000),
  input jsonb not null default '{}' check (jsonb_typeof(input) = 'object'),
  external_id text check (external_id is null or length(external_id) between 1 and 500),
  estimated_cost_cents integer not null check (estimated_cost_cents >= 0),
  actual_cost_cents integer check (actual_cost_cents is null or actual_cost_cents >= 0),
  attempts integer not null default 0 check (attempts between 0 and 20),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  error text,
  revision integer not null default 1,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_generation_outputs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  shot_id uuid not null references public.ad_shots(id) on delete cascade,
  job_id uuid not null references public.ad_generation_jobs(id) on delete cascade,
  storage_bucket text not null default 'ad-production',
  storage_path text not null check (length(storage_path) between 1 and 1000),
  thumbnail_path text,
  mime_type text not null default 'video/mp4',
  selected boolean not null default false,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (job_id, storage_path)
);
create unique index ad_one_selected_output_per_shot
  on public.ad_generation_outputs(shot_id) where selected;

create table public.ad_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.ad_campaigns(id) on delete cascade,
  brand_id uuid references public.ad_brands(id) on delete set null,
  output_id uuid references public.ad_generation_outputs(id) on delete set null,
  kind text not null check (kind in ('upload','generated','render','logo','screenshot','reference','audio')),
  storage_bucket text not null,
  storage_path text not null check (length(storage_path) between 1 and 1000),
  filename text not null check (length(filename) between 1 and 255),
  mime_type text not null check (length(mime_type) between 1 and 150),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table public.ad_render_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  variant_id text not null check (length(variant_id) between 1 and 150),
  status text not null default 'queued'
    check (status in ('queued','processing','succeeded','failed','canceled')),
  timeline jsonb not null check (jsonb_typeof(timeline) = 'object' and octet_length(timeline::text) <= 1000000),
  output_bucket text,
  output_path text,
  attempts integer not null default 0 check (attempts between 0 and 20),
  max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  error text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.ad_usage_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  generation_job_id uuid references public.ad_generation_jobs(id) on delete set null,
  render_job_id uuid references public.ad_render_jobs(id) on delete set null,
  provider text not null,
  kind text not null check (kind in ('generation','render','storage')),
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default 'job',
  cost_cents integer not null default 0 check (cost_cents >= 0),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.ad_creative_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  creative_id text not null check (length(creative_id) between 1 and 200),
  platform text not null check (platform in ('meta','youtube','tiktok','other')),
  metric_date date not null,
  spend_cents integer not null default 0 check (spend_cents >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  three_second_views integer not null default 0 check (three_second_views >= 0),
  completions integer not null default 0 check (completions >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  conversions numeric not null default 0 check (conversions >= 0),
  revenue_cents integer not null default 0 check (revenue_cents >= 0),
  score numeric(5,2) not null default 0 check (score between 0 and 100),
  raw jsonb not null default '{}' check (jsonb_typeof(raw) = 'object'),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, campaign_id, creative_id, platform, metric_date)
);

create index ad_shots_campaign_position on public.ad_shots(campaign_id, variant_id, position);
create index ad_generation_jobs_worker on public.ad_generation_jobs(status, next_attempt_at, lease_until);
create index ad_generation_jobs_shot on public.ad_generation_jobs(shot_id, created_at desc);
create index ad_generation_outputs_campaign on public.ad_generation_outputs(campaign_id, created_at desc);
create index ad_assets_campaign on public.ad_assets(campaign_id, created_at desc);
create index ad_render_jobs_worker on public.ad_render_jobs(status, next_attempt_at, lease_until);
create index ad_metrics_campaign on public.ad_creative_metrics(campaign_id, metric_date desc);
create index ad_shots_owner on public.ad_shots(owner_id);
create index ad_generation_jobs_owner on public.ad_generation_jobs(owner_id);
create index ad_generation_jobs_campaign on public.ad_generation_jobs(campaign_id);
create index ad_generation_outputs_owner on public.ad_generation_outputs(owner_id);
create index ad_assets_owner on public.ad_assets(owner_id);
create index ad_assets_brand on public.ad_assets(brand_id);
create index ad_assets_output on public.ad_assets(output_id);
create index ad_render_jobs_owner on public.ad_render_jobs(owner_id);
create index ad_render_jobs_campaign on public.ad_render_jobs(campaign_id);
create index ad_usage_events_owner on public.ad_usage_events(owner_id);
create index ad_usage_events_campaign on public.ad_usage_events(campaign_id);
create index ad_usage_events_generation_job on public.ad_usage_events(generation_job_id);
create index ad_usage_events_render_job on public.ad_usage_events(render_job_id);

create trigger ad_shots_touch before update on public.ad_shots
  for each row execute function public.ad_touch_record();
create trigger ad_generation_jobs_touch before update on public.ad_generation_jobs
  for each row execute function public.ad_touch_record();
create trigger ad_render_jobs_touch before update on public.ad_render_jobs
  for each row execute function public.ad_touch_record();
create trigger ad_metrics_touch before update on public.ad_creative_metrics
  for each row execute function public.ad_touch_record();

alter table public.ad_shots enable row level security;
alter table public.ad_generation_jobs enable row level security;
alter table public.ad_generation_outputs enable row level security;
alter table public.ad_assets enable row level security;
alter table public.ad_render_jobs enable row level security;
alter table public.ad_usage_events enable row level security;
alter table public.ad_creative_metrics enable row level security;

revoke all on public.ad_shots, public.ad_generation_jobs,
  public.ad_generation_outputs, public.ad_assets, public.ad_render_jobs,
  public.ad_usage_events, public.ad_creative_metrics from anon, authenticated;
grant select, insert, update, delete on public.ad_shots,
  public.ad_generation_jobs, public.ad_generation_outputs, public.ad_assets,
  public.ad_render_jobs, public.ad_creative_metrics to authenticated;
grant select on public.ad_usage_events to authenticated;

create policy own_ad_shots on public.ad_shots for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_generation_jobs on public.ad_generation_jobs for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_generation_outputs on public.ad_generation_outputs for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_assets on public.ad_assets for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_render_jobs on public.ad_render_jobs for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_usage_events on public.ad_usage_events for select to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));
create policy own_ad_creative_metrics on public.ad_creative_metrics for all to authenticated
using ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false))
with check ((select auth.uid()) = owner_id and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ad-production', 'ad-production', false, 536870912,
  array['video/mp4','video/quicktime','image/jpeg','image/png','image/webp','audio/mpeg','audio/wav']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read their production media"
on storage.objects for select to authenticated
using (bucket_id = 'ad-production' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can upload their production media"
on storage.objects for insert to authenticated
with check (bucket_id = 'ad-production' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users can delete their production media"
on storage.objects for delete to authenticated
using (bucket_id = 'ad-production' and (storage.foldername(name))[1] = (select auth.uid()::text));

create function public.enqueue_ad_generation_job(
  p_campaign_id uuid,
  p_variant_id text,
  p_beat_id text,
  p_position integer,
  p_spec jsonb,
  p_provider text,
  p_model text,
  p_prompt text,
  p_input jsonb,
  p_estimated_cost_cents integer
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_campaign public.ad_campaigns%rowtype;
  v_shot_id uuid;
  v_job_id uuid;
begin
  if v_owner is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A verified account is required';
  end if;
  select * into v_campaign from public.ad_campaigns
    where id = p_campaign_id and owner_id = v_owner for update;
  if not found then raise exception 'Campaign not found'; end if;
  if v_campaign.status <> 'approved' or v_campaign.production_approved_at is null then
    raise exception 'Approve the campaign and production budget first';
  end if;
  if p_estimated_cost_cents < 0 or
     v_campaign.spent_cents + v_campaign.reserved_cents + p_estimated_cost_cents > v_campaign.budget_cents then
    raise exception 'This generation exceeds the campaign budget';
  end if;
  insert into public.ad_shots(owner_id, campaign_id, variant_id, beat_id, position, spec)
  values (v_owner, p_campaign_id, p_variant_id, p_beat_id, p_position, p_spec)
  on conflict (campaign_id, variant_id, beat_id) do update
    set position = excluded.position, spec = excluded.spec
  returning id into v_shot_id;
  insert into public.ad_generation_jobs(
    owner_id, campaign_id, shot_id, provider, model, prompt, input, estimated_cost_cents
  ) values (
    v_owner, p_campaign_id, v_shot_id, p_provider, p_model, p_prompt, p_input, p_estimated_cost_cents
  ) returning id into v_job_id;
  update public.ad_campaigns
    set reserved_cents = reserved_cents + p_estimated_cost_cents
    where id = p_campaign_id;
  return v_job_id;
end;
$$;
revoke all on function public.enqueue_ad_generation_job(uuid,text,text,integer,jsonb,text,text,text,jsonb,integer) from public;
grant execute on function public.enqueue_ad_generation_job(uuid,text,text,integer,jsonb,text,text,text,jsonb,integer) to authenticated;

create function public.select_ad_generation_output(p_output_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_shot uuid;
begin
  select shot_id into v_shot from public.ad_generation_outputs
    where id = p_output_id and owner_id = v_owner;
  if not found then raise exception 'Candidate not found'; end if;
  update public.ad_generation_outputs set selected = false
    where shot_id = v_shot and owner_id = v_owner and selected;
  update public.ad_generation_outputs set selected = true
    where id = p_output_id and owner_id = v_owner;
end;
$$;
revoke all on function public.select_ad_generation_output(uuid) from public;
grant execute on function public.select_ad_generation_output(uuid) to authenticated;

create function public.claim_ad_generation_job() returns setof public.ad_generation_jobs
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.ad_generation_jobs
  where status in ('queued','processing') and next_attempt_at <= now()
    and (lease_until is null or lease_until < now())
    and attempts < max_attempts
  order by created_at for update skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.ad_generation_jobs
    set status='processing',
        started_at=coalesce(started_at,now()), lease_until=now()+interval '2 minutes'
    where id=v_id returning *;
end;
$$;
revoke all on function public.claim_ad_generation_job() from public, anon, authenticated;
grant execute on function public.claim_ad_generation_job() to service_role;

create function public.claim_ad_render_job() returns setof public.ad_render_jobs
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.ad_render_jobs
  where status in ('queued','processing') and next_attempt_at <= now()
    and (lease_until is null or lease_until < now())
    and attempts < max_attempts
  order by created_at for update skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.ad_render_jobs
    set status='processing', lease_until=now()+interval '15 minutes'
    where id=v_id returning *;
end;
$$;
revoke all on function public.claim_ad_render_job() from public, anon, authenticated;
grant execute on function public.claim_ad_render_job() to service_role;

create function public.finish_ad_generation_job(
  p_job_id uuid,
  p_status text,
  p_actual_cost_cents integer default 0,
  p_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.ad_generation_jobs%rowtype;
begin
  if p_status not in ('succeeded','failed','canceled') then
    raise exception 'Invalid terminal status';
  end if;
  if p_actual_cost_cents < 0 then raise exception 'Cost cannot be negative'; end if;

  select * into v_job from public.ad_generation_jobs
    where id = p_job_id for update;
  if not found then raise exception 'Generation job not found'; end if;
  if v_job.status in ('succeeded','failed','canceled') then return; end if;

  update public.ad_campaigns
    set reserved_cents = greatest(0, reserved_cents - v_job.estimated_cost_cents),
        spent_cents = spent_cents + case when p_status = 'succeeded' then p_actual_cost_cents else 0 end
    where id = v_job.campaign_id
      and spent_cents + greatest(0, reserved_cents - v_job.estimated_cost_cents)
        + case when p_status = 'succeeded' then p_actual_cost_cents else 0 end <= budget_cents;
  if not found then raise exception 'Final cost exceeds campaign budget'; end if;

  update public.ad_generation_jobs set
    status = p_status,
    actual_cost_cents = case when p_status = 'succeeded' then p_actual_cost_cents else 0 end,
    error = p_error,
    lease_until = null,
    completed_at = now()
  where id = p_job_id;

  if p_status = 'succeeded' then
    insert into public.ad_usage_events(
      owner_id, campaign_id, generation_job_id, provider, kind, quantity, unit, cost_cents
    ) values (
      v_job.owner_id, v_job.campaign_id, v_job.id, v_job.provider,
      'generation', coalesce((v_job.input->>'duration')::numeric, 1), 'second', p_actual_cost_cents
    );
  end if;
end;
$$;
revoke all on function public.finish_ad_generation_job(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.finish_ad_generation_job(uuid,text,integer,text) to service_role;
