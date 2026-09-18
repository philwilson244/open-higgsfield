import { MODELS } from "@/generation/catalog";
import type { ModelEntry } from "@/generation/catalog";

import type { AdTarget, AspectRatio } from "./types";

export type ModelRoutingRequest = {
  target: AdTarget;
  shotDurationSeconds: number;
  requireNativeAudio?: boolean;
  signals?: Readonly<Record<string, ModelRoutingSignals>>;
};

export type ModelRoutingSignals = {
  provider?: string;
  available?: boolean;
  estimatedCostCents?: number;
  providerHealth?: number;
  historicalQuality?: number;
};

export type ModelRoute = {
  modelId: string;
  modelLabel: string;
  score: number;
  renderAspectRatio: AspectRatio;
  requiresCrop: boolean;
  renderDurationSeconds: number;
  requiresTrim: boolean;
  reasons: string[];
};

export function rankVideoModels(
  request: ModelRoutingRequest,
  models: readonly ModelEntry[] = MODELS,
): ModelRoute[] {
  if (
    !Number.isFinite(request.shotDurationSeconds) ||
    request.shotDurationSeconds <= 0
  )
    return [];
  return models
    .flatMap((model) => {
      const route = scoreModel(model, request);
      return route ? [route] : [];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.modelLabel.localeCompare(right.modelLabel),
    );
}

function scoreModel(
  model: ModelEntry,
  request: ModelRoutingRequest,
): ModelRoute | null {
  if (model.surface !== "video") return null;
  const signals = request.signals?.[model.id];
  if (signals?.available === false) return null;

  const ratio = chooseRatio(model, request.target.aspectRatio);
  if (!ratio) return null;

  const duration = model.settings.duration;
  // Unknown duration and source-video-only entries are not executable text shots.
  const customTextModels = new Set([
    "seedance-2",
    "seedance-2-fast",
    "seedance-2-mini",
    "seedance-2.5",
    "kling-3-turbo",
    "kling-3-std",
    "kling-3-pro",
    "kling-3-4k",
  ]);
  if (
    duration?.type !== "range" ||
    !(model.paths?.text || customTextModels.has(model.id))
  )
    return null;
  const step = duration.step ?? 1;
  const renderDurationSeconds =
    Math.round(
      (duration.min +
        Math.ceil(
          Math.max(0, request.shotDurationSeconds - duration.min) / step - 1e-8,
        ) *
          step) *
        1000,
    ) / 1000;
  if (renderDurationSeconds > duration.max) return null;
  const requiresTrim =
    renderDurationSeconds - request.shotDurationSeconds > 0.01;

  const hasNativeAudio = Boolean(
    model.settings.generateAudio || model.settings.sound,
  );
  if (request.requireNativeAudio && !hasNativeAudio) return null;

  let score = 50;
  const reasons: string[] = [];

  if (!ratio.requiresCrop) {
    score += 25;
    reasons.push("native target aspect ratio");
  } else {
    score += 8;
    reasons.push(
      `generate ${ratio.renderAspectRatio}, then crop to ${request.target.aspectRatio}`,
    );
  }

  if (duration?.type === "range") {
    score += 10;
    reasons.push(
      requiresTrim
        ? `generate ${renderDurationSeconds}s, then trim`
        : "supports the shot duration",
    );
  }

  if (hasNativeAudio) {
    score += request.requireNativeAudio ? 15 : 5;
    reasons.push("native audio option");
  }

  if (model.roles.reference) {
    score += 5;
    reasons.push("accepts brand reference images");
  }

  if (model.roles.start) {
    score += 5;
    reasons.push("accepts a controlled start frame");
  }

  if (signals?.estimatedCostCents !== undefined) {
    const costPenalty = Math.min(25, Math.max(0, signals.estimatedCostCents) / 10);
    score -= costPenalty;
    reasons.push(`estimated cost $${(signals.estimatedCostCents / 100).toFixed(2)}`);
  }
  if (signals?.providerHealth !== undefined) {
    const health = Math.max(0, Math.min(1, signals.providerHealth));
    score += (health - 0.5) * 20;
    reasons.push(`${Math.round(health * 100)}% provider health`);
  }
  if (signals?.historicalQuality !== undefined) {
    const quality = Math.max(0, Math.min(1, signals.historicalQuality));
    score += quality * 20;
    reasons.push(`${Math.round(quality * 100)}% historical acceptance`);
  }
  if (signals?.provider) reasons.push(`available from ${signals.provider}`);

  return {
    modelId: model.id,
    modelLabel: model.label,
    score: Math.round(score * 100) / 100,
    renderAspectRatio: ratio.renderAspectRatio,
    requiresCrop: ratio.requiresCrop,
    renderDurationSeconds,
    requiresTrim,
    reasons,
  };
}

function chooseRatio(
  model: ModelEntry,
  target: AspectRatio,
): { renderAspectRatio: AspectRatio; requiresCrop: boolean } | null {
  const field = model.settings.aspectRatio;
  if (!field || field.type !== "enum") return null;

  if (field.values.includes(target)) {
    return { renderAspectRatio: target, requiresCrop: false };
  }

  if (target === "4:5" && field.values.includes("9:16")) {
    return { renderAspectRatio: "9:16", requiresCrop: true };
  }

  return null;
}
