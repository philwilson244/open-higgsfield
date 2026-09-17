import { MODELS } from "@/generation/catalog";
import type { ModelEntry } from "@/generation/catalog";

import type { AdTarget, AspectRatio } from "./types";

export type ModelRoutingRequest = {
  target: AdTarget;
  shotDurationSeconds: number;
  requireNativeAudio?: boolean;
};

export type ModelRoute = {
  modelId: string;
  modelLabel: string;
  score: number;
  renderAspectRatio: AspectRatio;
  requiresCrop: boolean;
  reasons: string[];
};

export function rankVideoModels(
  request: ModelRoutingRequest,
  models: readonly ModelEntry[] = MODELS,
): ModelRoute[] {
  return models
    .flatMap((model) => {
      const route = scoreModel(model, request);
      return route ? [route] : [];
    })
    .sort((left, right) => right.score - left.score || left.modelLabel.localeCompare(right.modelLabel));
}

function scoreModel(model: ModelEntry, request: ModelRoutingRequest): ModelRoute | null {
  if (model.surface !== "video") return null;

  const ratio = chooseRatio(model, request.target.aspectRatio);
  if (!ratio) return null;

  const duration = model.settings.duration;
  if (
    duration?.type === "range" &&
    (request.shotDurationSeconds < duration.min || request.shotDurationSeconds > duration.max)
  ) {
    return null;
  }

  const hasNativeAudio = Boolean(model.settings.generateAudio || model.settings.sound);
  if (request.requireNativeAudio && !hasNativeAudio) return null;

  let score = 50;
  const reasons: string[] = [];

  if (!ratio.requiresCrop) {
    score += 25;
    reasons.push("native target aspect ratio");
  } else {
    score += 8;
    reasons.push(`generate ${ratio.renderAspectRatio}, then crop to ${request.target.aspectRatio}`);
  }

  if (duration?.type === "range") {
    score += 10;
    reasons.push("supports the shot duration");
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

  return {
    modelId: model.id,
    modelLabel: model.label,
    score,
    renderAspectRatio: ratio.renderAspectRatio,
    requiresCrop: ratio.requiresCrop,
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
