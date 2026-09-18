create policy deny_client_ad_rate_windows on public.ad_rate_windows
for select to authenticated using (false);

create index ad_audit_events_actor on public.ad_audit_events(actor_id);

create function ad_internal.enqueue_ad_generation_job(
  p_owner uuid,
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
language plpgsql security definer set search_path = '' as $$
declare
  v_campaign public.ad_campaigns%rowtype;
  v_shot_id uuid;
  v_job_id uuid;
begin
  if p_owner is null or p_owner is distinct from auth.uid()
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A verified account is required';
  end if;
  select * into v_campaign from public.ad_campaigns
    where id = p_campaign_id and owner_id = p_owner for update;
  if not found then raise exception 'Campaign not found'; end if;
  if v_campaign.status <> 'approved' or v_campaign.production_approved_at is null then
    raise exception 'Approve the campaign and production budget first';
  end if;
  if p_estimated_cost_cents < 0 or
     v_campaign.spent_cents + v_campaign.reserved_cents + p_estimated_cost_cents > v_campaign.budget_cents then
    raise exception 'This generation exceeds the campaign budget';
  end if;
  insert into public.ad_shots(owner_id,campaign_id,variant_id,beat_id,position,spec)
  values (p_owner,p_campaign_id,p_variant_id,p_beat_id,p_position,p_spec)
  on conflict (campaign_id,variant_id,beat_id) do update
    set position=excluded.position,spec=excluded.spec
  returning id into v_shot_id;
  insert into public.ad_generation_jobs(
    owner_id,campaign_id,shot_id,provider,model,prompt,input,estimated_cost_cents
  ) values (
    p_owner,p_campaign_id,v_shot_id,p_provider,p_model,p_prompt,p_input,p_estimated_cost_cents
  ) returning id into v_job_id;
  update public.ad_campaigns set reserved_cents=reserved_cents+p_estimated_cost_cents
    where id=p_campaign_id and owner_id=p_owner;
  return v_job_id;
end;
$$;
revoke all on function ad_internal.enqueue_ad_generation_job(uuid,uuid,text,text,integer,jsonb,text,text,text,jsonb,integer)
  from public,anon;
grant execute on function ad_internal.enqueue_ad_generation_job(uuid,uuid,text,text,integer,jsonb,text,text,text,jsonb,integer)
  to authenticated;

create or replace function public.enqueue_ad_generation_job(
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
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A verified account is required';
  end if;
  return ad_internal.enqueue_ad_generation_job(
    auth.uid(),p_campaign_id,p_variant_id,p_beat_id,p_position,p_spec,
    p_provider,p_model,p_prompt,p_input,p_estimated_cost_cents
  );
end;
$$;
revoke all on function public.enqueue_ad_generation_job(uuid,text,text,integer,jsonb,text,text,text,jsonb,integer)
  from public,anon;
grant execute on function public.enqueue_ad_generation_job(uuid,text,text,integer,jsonb,text,text,text,jsonb,integer)
  to authenticated;

create function ad_internal.request_cancel_ad_generation_job(p_owner uuid,p_job_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_job public.ad_generation_jobs%rowtype;
begin
  if p_owner is null or p_owner is distinct from auth.uid()
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A verified account is required';
  end if;
  select * into v_job from public.ad_generation_jobs
    where id=p_job_id and owner_id=p_owner for update;
  if not found then raise exception 'Generation job not found'; end if;
  if v_job.status in ('succeeded','failed','canceled') then return v_job.status; end if;
  if v_job.status='queued' and v_job.external_id is null then
    update public.ad_generation_jobs set status='canceled',cancel_requested_at=now(),
      completed_at=now(),actual_cost_cents=0,lease_until=null where id=p_job_id;
    update public.ad_campaigns set reserved_cents=greatest(0,reserved_cents-v_job.estimated_cost_cents)
      where id=v_job.campaign_id and owner_id=p_owner;
    return 'canceled';
  end if;
  update public.ad_generation_jobs set cancel_requested_at=now() where id=p_job_id;
  return 'cancel_requested';
end;
$$;
revoke all on function ad_internal.request_cancel_ad_generation_job(uuid,uuid) from public,anon;
grant execute on function ad_internal.request_cancel_ad_generation_job(uuid,uuid) to authenticated;

create or replace function public.request_cancel_ad_generation_job(p_job_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'A verified account is required';
  end if;
  return ad_internal.request_cancel_ad_generation_job(auth.uid(),p_job_id);
end;
$$;
revoke all on function public.request_cancel_ad_generation_job(uuid) from public,anon;
grant execute on function public.request_cancel_ad_generation_job(uuid) to authenticated;
