import type { GenerationPlane, ModelEntry } from "../catalog";
import type { GenerationStatus, QueuedGeneration } from "../platform";

export type ProviderId = string;

export type ProviderCapabilities = {
  textToVideo: boolean;
  imageToVideo: boolean;
  referenceToVideo: boolean;
  nativeAudio: boolean;
};

export type ProviderSubmission = {
  model: ModelEntry;
  plane: GenerationPlane;
};

export interface GenerationProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  submit(input: ProviderSubmission): Promise<QueuedGeneration>;
  status(requestId: string): Promise<GenerationStatus>;
}
