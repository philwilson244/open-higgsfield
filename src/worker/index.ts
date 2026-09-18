import { createServer } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { adminDatabase } from "../lib/supabase/admin";
import { decryptSecret } from "../lib/secrets";
import { createRunwayClient, RUNWAY_PROVIDER_ID } from "../generation/providers/runway";
import type { AdTimelineProps } from "../render/AdTimeline";

type GenerationJob = {
  id: string; owner_id: string; campaign_id: string; shot_id: string;
  provider: string; model: string; prompt: string; input: Record<string, unknown>;
  external_id: string | null; estimated_cost_cents: number; attempts: number; max_attempts: number;
};
type RenderJob = {
  id: string; owner_id: string; campaign_id: string; variant_id: string;
  timeline: { brand: string; target: { width: number; height: number }; clips: Array<{
    beat: { startSeconds: number; endSeconds: number; onScreenText?: string };
    media: { bucket: string; path: string };
  }> }; attempts: number; max_attempts: number;
};

const db = adminDatabase();
const pollMs = Math.max(1000, Number(process.env.WORKER_POLL_MS ?? 5000));
let remotionBundle: Promise<string> | undefined;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 4000) : "Unknown worker error";
}

async function rescheduleGeneration(job: GenerationJob, error?: unknown) {
  const attempts = job.attempts + (error ? 1 : 0);
  if (error && attempts >= job.max_attempts) {
    await db.rpc("finish_ad_generation_job", {
      p_job_id: job.id, p_status: "failed", p_actual_cost_cents: 0, p_error: errorMessage(error),
    });
    return;
  }
  await db.from("ad_generation_jobs").update({
    status: "processing", lease_until: null,
    attempts,
    next_attempt_at: new Date(Date.now() + 15_000).toISOString(),
    ...(error ? { error: errorMessage(error) } : {}),
  }).eq("id", job.id);
}

async function processGeneration(job: GenerationJob) {
  try {
    if (job.provider !== RUNWAY_PROVIDER_ID) throw new Error(`Unsupported provider: ${job.provider}`);
    const { data: account, error } = await db.from("ad_provider_accounts")
      .select("encrypted_key").eq("owner_id", job.owner_id).eq("provider", job.provider).single();
    if (error || !account) throw new Error("Runway credentials are unavailable");
    const client = createRunwayClient(decryptSecret(account.encrypted_key, `${job.owner_id}:${job.provider}`));
    if (!job.external_id) {
      const submitted = await client.submitTextVideo({
        model: job.model,
        promptText: job.prompt,
        ratio: job.input.ratio === "1280:720" ? "1280:720" : "720:1280",
        duration: Number(job.input.duration),
      });
      await db.from("ad_generation_jobs").update({
        external_id: submitted.id, status: "processing", lease_until: null,
        next_attempt_at: new Date(Date.now() + 15_000).toISOString(), error: null,
      }).eq("id", job.id);
      return;
    }
    const task = await client.task(job.external_id);
    if (["PENDING", "THROTTLED", "RUNNING"].includes(task.status)) return rescheduleGeneration(job);
    if (task.status !== "SUCCEEDED" || !task.output?.[0]) {
      await db.rpc("finish_ad_generation_job", {
        p_job_id: job.id, p_status: task.status === "CANCELLED" ? "canceled" : "failed",
        p_actual_cost_cents: 0, p_error: task.failure ?? `Runway task ${task.status.toLowerCase()}`,
      });
      return;
    }
    const response = await fetch(task.output[0], { signal: AbortSignal.timeout(120_000), redirect: "error" });
    if (!response.ok) throw new Error(`Could not copy Runway output (${response.status})`);
    const body = await response.arrayBuffer();
    if (body.byteLength > 536_870_912) throw new Error("Runway output exceeded the 512 MB limit");
    const path = `${job.owner_id}/${job.campaign_id}/generations/${job.id}.mp4`;
    const uploaded = await db.storage.from("ad-production").upload(path, body, { contentType: "video/mp4", upsert: true });
    if (uploaded.error) throw uploaded.error;
    const { data: output, error: outputError } = await db.from("ad_generation_outputs").upsert({
      owner_id: job.owner_id, campaign_id: job.campaign_id, shot_id: job.shot_id, job_id: job.id,
      storage_bucket: "ad-production", storage_path: path, mime_type: "video/mp4",
      metadata: { runwayTaskId: job.external_id, runway: task.metadata ?? {} },
    }, { onConflict: "job_id,storage_path" }).select("id").single();
    if (outputError) throw outputError;
    const asset = await db.from("ad_assets").upsert({
      owner_id: job.owner_id, campaign_id: job.campaign_id, output_id: output.id, kind: "generated",
      storage_bucket: "ad-production", storage_path: path, filename: `${job.id}.mp4`,
      mime_type: "video/mp4", size_bytes: body.byteLength, metadata: { provider: job.provider, model: job.model },
    }, { onConflict: "storage_bucket,storage_path" });
    if (asset.error) throw asset.error;
    const finished = await db.rpc("finish_ad_generation_job", {
      p_job_id: job.id, p_status: "succeeded", p_actual_cost_cents: job.estimated_cost_cents, p_error: null,
    });
    if (finished.error) throw finished.error;
  } catch (error) {
    console.error("generation", job.id, errorMessage(error));
    await rescheduleGeneration(job, error);
  }
}

async function processRender(job: RenderJob) {
  const work = join(tmpdir(), `openhiggsfield-${job.id}`);
  try {
    await mkdir(work, { recursive: true });
    const clips: AdTimelineProps["clips"] = [];
    for (const clip of job.timeline.clips) {
      const signed = await db.storage.from(clip.media.bucket).createSignedUrl(clip.media.path, 3600);
      if (signed.error || !signed.data.signedUrl) throw new Error("Could not sign a selected media clip");
      clips.push({ src: signed.data.signedUrl, ...clip.beat });
    }
    remotionBundle ??= bundle({ entryPoint: join(process.cwd(), "src/render/Root.tsx") });
    const serveUrl = await remotionBundle;
    const inputProps: AdTimelineProps = { brand: job.timeline.brand, clips };
    const composition = await selectComposition({ serveUrl, id: "AdTimeline", inputProps });
    const output = join(work, "campaign.mp4");
    await renderMedia({
      composition: { ...composition, width: job.timeline.target.width, height: job.timeline.target.height },
      serveUrl, codec: "h264", outputLocation: output, inputProps,
      browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null,
    });
    const bytes = await readFile(output);
    const path = `${job.owner_id}/${job.campaign_id}/renders/${job.id}.mp4`;
    const uploaded = await db.storage.from("ad-production").upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (uploaded.error) throw uploaded.error;
    const asset = await db.from("ad_assets").upsert({
      owner_id: job.owner_id, campaign_id: job.campaign_id, kind: "render",
      storage_bucket: "ad-production", storage_path: path, filename: `${job.variant_id}.mp4`,
      mime_type: "video/mp4", size_bytes: bytes.byteLength, metadata: { renderJobId: job.id },
    }, { onConflict: "storage_bucket,storage_path" });
    if (asset.error) throw asset.error;
    await db.from("ad_render_jobs").update({
      status: "succeeded", output_bucket: "ad-production", output_path: path,
      lease_until: null, completed_at: new Date().toISOString(), error: null,
    }).eq("id", job.id);
  } catch (error) {
    console.error("render", job.id, errorMessage(error));
    const attempts = job.attempts + 1;
    await db.from("ad_render_jobs").update(attempts >= job.max_attempts ? {
      status: "failed", attempts, lease_until: null, completed_at: new Date().toISOString(), error: errorMessage(error),
    } : {
      status: "processing", attempts, lease_until: null, next_attempt_at: new Date(Date.now() + 30_000).toISOString(), error: errorMessage(error),
    }).eq("id", job.id);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function tick() {
  const generation = await db.rpc("claim_ad_generation_job");
  if (generation.error) throw generation.error;
  if (generation.data?.[0]) await processGeneration(generation.data[0] as GenerationJob);
  const render = await db.rpc("claim_ad_render_job");
  if (render.error) throw render.error;
  if (render.data?.[0]) await processRender(render.data[0] as RenderJob);
}

const port = Number(process.env.PORT ?? 8080);
createServer((request, response) => {
  response.writeHead(request.url === "/health" ? 200 : 404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: request.url === "/health" }));
}).listen(port, () => console.log(`production worker health server listening on ${port}`));

async function run() {
  for (;;) {
    try { await tick(); } catch (error) { console.error("worker tick", errorMessage(error)); }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
void run();
