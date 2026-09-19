import { FAL_PROVIDER_ID } from "./fal";
import { RUNWAY_PROVIDER_ID } from "./runway";

export type ModelAvailability = "live" | "connect_provider" | "catalog_only";

export type ProductionModel = {
  id: string;
  catalogModelId?: string;
  label: string;
  provider: string;
  providerModel: string;
  availability: ModelAvailability;
  estimatedCentsPerSecond: number;
  supportsReferenceImage: boolean;
  supportsNativeAudio: boolean;
};

export const PRODUCTION_MODELS: readonly ProductionModel[] = [
  {
    id: "runway-gen4.5",
    label: "Runway Gen-4.5",
    provider: RUNWAY_PROVIDER_ID,
    providerModel: "gen4.5",
    availability: "live",
    estimatedCentsPerSecond: 12,
    supportsReferenceImage: false,
    supportsNativeAudio: false,
  },
  {
    id: "runway-gen4-turbo",
    label: "Runway Gen-4 Turbo",
    provider: RUNWAY_PROVIDER_ID,
    providerModel: "gen4_turbo",
    availability: "live",
    estimatedCentsPerSecond: 5,
    supportsReferenceImage: false,
    supportsNativeAudio: false,
  },
  {
    id: "fal-kling-video",
    catalogModelId: "kling-3-pro",
    label: "Kling Video",
    provider: FAL_PROVIDER_ID,
    providerModel: "fal-ai/kling-video/v2.1/master/text-to-video",
    availability: "connect_provider",
    estimatedCentsPerSecond: 14,
    supportsReferenceImage: false,
    supportsNativeAudio: false,
  },
  {
    id: "fal-kling-image-video",
    catalogModelId: "kling-3-std",
    label: "Kling Image-to-Video",
    provider: FAL_PROVIDER_ID,
    providerModel: "fal-ai/kling-video/v2.1/master/image-to-video",
    availability: "connect_provider",
    estimatedCentsPerSecond: 14,
    supportsReferenceImage: true,
    supportsNativeAudio: false,
  },
  {
    id: "fal-minimax-video",
    catalogModelId: "minimax-hailuo-2.3",
    label: "MiniMax Hailuo Video",
    provider: FAL_PROVIDER_ID,
    providerModel: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    availability: "connect_provider",
    estimatedCentsPerSecond: 10,
    supportsReferenceImage: false,
    supportsNativeAudio: false,
  },
  {
    id: "fal-wan-video",
    catalogModelId: "wan-2.7",
    label: "Wan Video",
    provider: FAL_PROVIDER_ID,
    providerModel: "fal-ai/wan/v2.2-a14b/text-to-video",
    availability: "connect_provider",
    estimatedCentsPerSecond: 8,
    supportsReferenceImage: false,
    supportsNativeAudio: false,
  },
];

export function getProductionModel(id: string): ProductionModel {
  const model = PRODUCTION_MODELS.find((entry) => entry.id === id);
  if (!model) throw new Error(`Unknown production model: ${id}`);
  return model;
}

export function estimateProductionCents(model: ProductionModel, durationSeconds: number, candidates = 1) {
  return Math.ceil(durationSeconds) * model.estimatedCentsPerSecond * candidates;
}

export function modelAvailability(id: string): ModelAvailability {
  return PRODUCTION_MODELS.find((entry) => entry.id === id || entry.catalogModelId === id)?.availability ?? "catalog_only";
}
