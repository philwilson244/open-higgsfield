export const RUNWAY_PROVIDER_ID = "runway";
export const RUNWAY_DEFAULT_MODEL = "gen4.5";
export const RUNWAY_API_ORIGIN = "https://api.dev.runwayml.com";
export const RUNWAY_API_VERSION = "2024-11-06";

const CREDIT_CENTS: Record<string, number> = {
  "gen4.5": 12,
  gen4_turbo: 5,
  gemini_omni_flash: 10,
};

export function estimateRunwayVideoCents(
  model: string,
  durationSeconds: number,
  candidates = 1,
): number {
  const centsPerSecond = CREDIT_CENTS[model];
  if (!centsPerSecond) throw new Error(`No current price is configured for ${model}`);
  return Math.ceil(durationSeconds) * centsPerSecond * candidates;
}

export function runwayRatio(aspectRatio: string): "720:1280" | "1280:720" {
  return aspectRatio === "16:9" ? "1280:720" : "720:1280";
}

export type RunwayTask = {
  id: string;
  status: "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  output?: string[];
  failure?: string;
  failureCode?: string;
  metadata?: Record<string, unknown>;
};

export function createRunwayClient(apiSecret: string, fetchImpl: typeof fetch = fetch) {
  async function request(path: string, init?: RequestInit) {
    const response = await fetchImpl(`${RUNWAY_API_ORIGIN}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
      headers: {
        Authorization: `Bearer ${apiSecret}`,
        "X-Runway-Version": RUNWAY_API_VERSION,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : `Runway request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  return {
    async submitTextVideo(input: {
      model: string;
      promptText: string;
      ratio: "720:1280" | "1280:720";
      duration: number;
    }): Promise<{ id: string }> {
      const payload = await request("/v1/text_to_video", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!payload || typeof payload !== "object" || typeof (payload as { id?: unknown }).id !== "string")
        throw new Error("Runway did not return a task ID");
      return payload as { id: string };
    },
    async task(id: string): Promise<RunwayTask> {
      return (await request(`/v1/tasks/${encodeURIComponent(id)}`)) as RunwayTask;
    },
    async cancel(id: string): Promise<void> {
      await request(`/v1/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
}
