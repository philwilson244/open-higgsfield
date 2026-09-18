"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/secrets";
import { planSchema } from "./schema";
import { shotPrompt } from "./storyboard";
import { parseMetricsCsv } from "./analytics";
import type { AuditEvent, CreativeMetric, GenerationJob, GenerationOutput, ProductionState, RenderJob } from "./production-types";
import {
  estimateRunwayVideoCents,
  RUNWAY_DEFAULT_MODEL,
  RUNWAY_PROVIDER_ID,
  runwayRatio,
} from "@/generation/providers/runway";

type ActionResult<T = undefined> =
  | { data: T; error?: never }
  | { error: string; data?: never };

const campaignIdSchema = z.uuid();
const enqueueSchema = z.object({
  campaignId: campaignIdSchema,
  variantId: z.string().min(1).max(150),
  beatId: z.string().min(1).max(150),
  candidates: z.number().int().min(1).max(4).default(2),
  model: z.enum(["gen4.5", "gen4_turbo"]).default(RUNWAY_DEFAULT_MODEL),
});

export async function saveRunwayCredentials(secret: string): Promise<ActionResult> {
  try {
    const value = z.string().trim().min(20).max(4096).parse(secret);
    const { db, user } = await requireAccount();
    const encrypted_key = encryptSecret(value, `${user.id}:${RUNWAY_PROVIDER_ID}`);
    const { error } = await db.from("ad_provider_accounts").upsert(
      { owner_id: user.id, provider: RUNWAY_PROVIDER_ID, encrypted_key },
      { onConflict: "owner_id,provider" },
    );
    if (error) throw error;
    return { data: undefined };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the Runway key" };
  }
}

export async function hasRunwayCredentials(): Promise<boolean> {
  try {
    const { db, user } = await requireAccount();
    const { data } = await db.from("ad_provider_accounts")
      .select("provider").eq("owner_id", user.id).eq("provider", RUNWAY_PROVIDER_ID).maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function enqueueShotCandidates(input: unknown): Promise<ActionResult<{ jobIds: string[] }>> {
  try {
    const value = enqueueSchema.parse(input);
    const { db, user } = await requireAccount();
    const [{ data: campaign, error: campaignError }, { data: credential }] = await Promise.all([
      db.from("ad_campaigns")
        .select("id, owner_id, status, budget_cents, reserved_cents, spent_cents, production_approved_at, plan")
        .eq("id", value.campaignId).eq("owner_id", user.id).single(),
      db.from("ad_provider_accounts")
        .select("provider").eq("owner_id", user.id).eq("provider", RUNWAY_PROVIDER_ID).maybeSingle(),
    ]);
    if (campaignError || !campaign) throw new Error("Campaign not found");
    if (!credential) throw new Error("Add a Runway API key before generating");
    if (campaign.status !== "approved" || !campaign.production_approved_at)
      throw new Error("Approve the storyboard and production budget before generating");
    const plan = planSchema.parse(campaign.plan);
    const variant = plan.variants.find((item) => item.id === value.variantId);
    const beatIndex = variant?.beats.findIndex((item) => item.id === value.beatId) ?? -1;
    const beat = beatIndex >= 0 ? variant?.beats[beatIndex] : undefined;
    if (!variant || !beat) throw new Error("Storyboard shot not found");
    const duration = Math.max(2, Math.min(10, Math.ceil(beat.endSeconds - beat.startSeconds)));
    const totalEstimate = estimateRunwayVideoCents(value.model, duration, value.candidates);
    if (campaign.spent_cents + campaign.reserved_cents + totalEstimate > campaign.budget_cents)
      throw new Error("These candidates exceed the remaining campaign budget");
    const prompt = shotPrompt(plan.brief, beat);
    const estimateEach = estimateRunwayVideoCents(value.model, duration, 1);
    const jobIds: string[] = [];
    for (let candidateIndex = 0; candidateIndex < value.candidates; candidateIndex += 1) {
      const { data, error } = await db.rpc("enqueue_ad_generation_job", {
        p_campaign_id: campaign.id,
        p_variant_id: variant.id,
        p_beat_id: beat.id,
        p_position: beatIndex,
        p_spec: { beat, target: variant.target, candidateIndex },
        p_provider: RUNWAY_PROVIDER_ID,
        p_model: value.model,
        p_prompt: prompt,
        p_input: {
          ratio: runwayRatio(variant.target.aspectRatio),
          duration,
          candidateIndex,
        },
        p_estimated_cost_cents: estimateEach,
      });
      if (error || typeof data !== "string") throw new Error(error?.message ?? "Could not queue generation");
      jobIds.push(data);
    }
    return { data: { jobIds } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not queue generation" };
  }
}

export async function selectGenerationCandidate(outputId: string): Promise<ActionResult> {
  try {
    const id = z.uuid().parse(outputId);
    const { db } = await requireAccount();
    const { error } = await db.rpc("select_ad_generation_output", { p_output_id: id });
    if (error) throw error;
    revalidatePath("/ads");
    return { data: undefined };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not select candidate" };
  }
}

export async function cancelGenerationJob(jobId: string): Promise<ActionResult<{ status: string }>> {
  try {
    const id = z.uuid().parse(jobId);
    const { db } = await requireAccount();
    const { data, error } = await db.rpc("request_cancel_ad_generation_job", { p_job_id: id });
    if (error) throw error;
    revalidatePath("/ads");
    return { data: { status: String(data) } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not cancel generation" };
  }
}

export async function enqueueCampaignRender(input: unknown): Promise<ActionResult<{ renderId: string }>> {
  try {
    const value = z.object({ campaignId: z.uuid(), variantId: z.string().min(1).max(150) }).parse(input);
    const { db, user } = await requireAccount();
    const { data: campaign, error: campaignError } = await db.from("ad_campaigns")
      .select("id, status, production_approved_at, plan")
      .eq("id", value.campaignId).eq("owner_id", user.id).single();
    if (campaignError || !campaign) throw new Error("Campaign not found");
    if (campaign.status !== "approved" || !campaign.production_approved_at)
      throw new Error("Approve production before rendering");
    const { error: quotaError } = await db.rpc("consume_ad_quota", {
      p_action: "render", p_units: 1, p_cost_cents: 0,
    });
    if (quotaError) throw new Error(quotaError.message);
    const plan = planSchema.parse(campaign.plan);
    const variant = plan.variants.find((item) => item.id === value.variantId);
    if (!variant) throw new Error("Storyboard variant not found");
    const { data: shots, error: shotError } = await db.from("ad_shots")
      .select("id, beat_id, position, ad_generation_outputs(id, storage_bucket, storage_path, selected)")
      .eq("campaign_id", campaign.id).eq("owner_id", user.id).eq("variant_id", variant.id)
      .order("position");
    if (shotError) throw shotError;
    const selected = new Map<string, { bucket: string; path: string }>();
    for (const shot of shots ?? []) {
      const outputs = Array.isArray(shot.ad_generation_outputs) ? shot.ad_generation_outputs : [];
      const output = outputs.find((item) => item.selected);
      if (output) selected.set(shot.beat_id, { bucket: output.storage_bucket, path: output.storage_path });
    }
    if (variant.beats.some((beat) => !selected.has(beat.id)))
      throw new Error("Select one generated candidate for every shot before rendering");
    const timeline = {
      name: variant.name,
      target: variant.target,
      brand: plan.brief.brandName,
      clips: variant.beats.map((beat) => ({
        beat,
        media: selected.get(beat.id),
      })),
    };
    const { data, error } = await db.from("ad_render_jobs").insert({
      owner_id: user.id,
      campaign_id: campaign.id,
      variant_id: variant.id,
      timeline,
    }).select("id").single();
    if (error) throw error;
    return { data: { renderId: data.id } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not queue the final render" };
  }
}

export async function getProductionState(campaignId: string): Promise<ActionResult<ProductionState>> {
  try {
    const id = campaignIdSchema.parse(campaignId);
    const { db, user } = await requireAccount();
    const [jobs, outputs, renders, metrics, audits] = await Promise.all([
      db.from("ad_generation_jobs").select("id,campaign_id,shot_id,provider,model,status,estimated_cost_cents,actual_cost_cents,error,cancel_requested_at,created_at,ad_shots(beat_id)")
        .eq("campaign_id", id).eq("owner_id", user.id).order("created_at", { ascending: false }),
      db.from("ad_generation_outputs").select("id,campaign_id,shot_id,job_id,selected,mime_type,metadata,storage_bucket,storage_path,created_at")
        .eq("campaign_id", id).eq("owner_id", user.id).order("created_at", { ascending: false }),
      db.from("ad_render_jobs").select("id,campaign_id,variant_id,status,output_bucket,output_path,error,created_at")
        .eq("campaign_id", id).eq("owner_id", user.id).order("created_at", { ascending: false }),
      db.from("ad_creative_metrics").select("id,campaign_id,creative_id,platform,metric_date,spend_cents,impressions,three_second_views,completions,clicks,conversions,revenue_cents,score")
        .eq("campaign_id", id).eq("owner_id", user.id).order("score", { ascending: false }),
      db.from("ad_audit_events").select("id,campaign_id,actor_id,event_type,entity_type,entity_id,details,created_at")
        .eq("campaign_id", id).eq("owner_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);
    const firstError = jobs.error ?? outputs.error ?? renders.error ?? metrics.error ?? audits.error;
    if (firstError) throw firstError;
    const signedOutputs = await Promise.all((outputs.data ?? []).map(async (output) => {
      const { data } = await db.storage.from(output.storage_bucket).createSignedUrl(output.storage_path, 3600);
      return { ...output, signedUrl: data?.signedUrl ?? "" } as GenerationOutput;
    }));
    const signedRenders = await Promise.all((renders.data ?? []).map(async (render) => {
      if (!render.output_bucket || !render.output_path) return render as RenderJob;
      const { data } = await db.storage.from(render.output_bucket).createSignedUrl(render.output_path, 3600);
      return { ...render, signedUrl: data?.signedUrl ?? undefined } as RenderJob;
    }));
    return {
      data: {
        jobs: (jobs.data ?? []).map((job) => ({
          ...job,
          beat_id:
            job.ad_shots && typeof job.ad_shots === "object" && "beat_id" in job.ad_shots
              ? String(job.ad_shots.beat_id)
              : "",
          ad_shots: undefined,
        })) as GenerationJob[],
        outputs: signedOutputs,
        renders: signedRenders,
        metrics: (metrics.data ?? []) as CreativeMetric[],
        audits: (audits.data ?? []) as AuditEvent[],
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not load production state" };
  }
}

export async function importCampaignMetrics(input: unknown): Promise<ActionResult<{ imported: number }>> {
  try {
    const value = z.object({ campaignId: z.uuid(), csv: z.string().min(1).max(2_000_000) }).parse(input);
    const rows = parseMetricsCsv(value.csv);
    const { db, user } = await requireAccount();
    const { data: campaign } = await db.from("ad_campaigns").select("id")
      .eq("id", value.campaignId).eq("owner_id", user.id).maybeSingle();
    if (!campaign) throw new Error("Campaign not found");
    const { error: quotaError } = await db.rpc("consume_ad_quota", {
      p_action: "analytics", p_units: 1, p_cost_cents: 0,
    });
    if (quotaError) throw new Error(quotaError.message);
    const payload = rows.map((row) => ({
      owner_id: user.id,
      campaign_id: campaign.id,
      creative_id: row.creativeId,
      platform: row.platform,
      metric_date: row.metricDate,
      spend_cents: row.spendCents,
      impressions: row.impressions,
      three_second_views: row.threeSecondViews,
      completions: row.completions,
      clicks: row.clicks,
      conversions: row.conversions,
      revenue_cents: row.revenueCents,
      score: row.score,
      raw: row.raw,
    }));
    const { error } = await db.from("ad_creative_metrics").upsert(payload, {
      onConflict: "owner_id,campaign_id,creative_id,platform,metric_date",
    });
    if (error) throw error;
    return { data: { imported: payload.length } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not import analytics" };
  }
}
