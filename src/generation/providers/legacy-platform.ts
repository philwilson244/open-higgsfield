import { createPlatformClient } from "../platform";
import type { PlatformClientOptions } from "../platform";
import { toPlatform } from "../to-platform";
import type { GenerationProvider } from "./types";

export function createLegacyPlatformProvider(
  options: PlatformClientOptions,
): GenerationProvider {
  const client = createPlatformClient(options);

  return {
    id: "higgsfield-platform",
    label: "Higgsfield Platform API",
    capabilities: {
      textToVideo: true,
      imageToVideo: true,
      referenceToVideo: true,
      nativeAudio: true,
    },
    async submit({ plane }) {
      const { path, body } = toPlatform(plane);
      return client.submit(path, body);
    },
    status(requestId) {
      return client.status(requestId);
    },
  };
}
