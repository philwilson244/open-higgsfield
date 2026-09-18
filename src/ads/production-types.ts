export type ProductionJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type GenerationJob = {
  id: string;
  campaign_id: string;
  shot_id: string;
  beat_id: string;
  provider: string;
  model: string;
  status: ProductionJobStatus;
  estimated_cost_cents: number;
  actual_cost_cents: number | null;
  error: string | null;
  cancel_requested_at: string | null;
  created_at: string;
};

export type GenerationOutput = {
  id: string;
  campaign_id: string;
  shot_id: string;
  job_id: string;
  selected: boolean;
  mime_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  signedUrl: string;
};

export type RenderJob = {
  id: string;
  campaign_id: string;
  variant_id: string;
  status: ProductionJobStatus;
  output_path: string | null;
  error: string | null;
  created_at: string;
  signedUrl?: string;
};

export type CreativeMetric = {
  id: string;
  campaign_id: string;
  creative_id: string;
  platform: "meta" | "youtube" | "tiktok" | "other";
  metric_date: string;
  spend_cents: number;
  impressions: number;
  three_second_views: number;
  completions: number;
  clicks: number;
  conversions: number;
  revenue_cents: number;
  score: number;
};

export type AuditEvent = {
  id: number;
  campaign_id: string | null;
  actor_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type ProductionState = {
  jobs: GenerationJob[];
  outputs: GenerationOutput[];
  renders: RenderJob[];
  metrics: CreativeMetric[];
  audits: AuditEvent[];
};
