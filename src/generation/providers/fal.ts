export const FAL_PROVIDER_ID = "fal";
export const FAL_QUEUE_ORIGIN = "https://queue.fal.run";

export type FalSubmission = {
  request_id: string;
  status_url?: string;
  response_url?: string;
  cancel_url?: string;
};

export type FalStatus = {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  error?: string | { message?: string };
  video?: { url?: string };
  videos?: Array<{ url?: string }>;
  output?: { url?: string } | Array<{ url?: string }>;
};

function outputUrl(payload: FalStatus): string | undefined {
  if (payload.video?.url) return payload.video.url;
  if (payload.videos?.[0]?.url) return payload.videos[0].url;
  if (Array.isArray(payload.output)) return payload.output[0]?.url;
  return payload.output?.url;
}

export function createFalClient(apiSecret: string, fetchImpl: typeof fetch = fetch) {
  async function request(url: string, init?: RequestInit) {
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
      headers: {
        Authorization: `Key ${apiSecret}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload = (await response.json().catch(() => null)) as FalStatus | FalSubmission | null;
    if (!response.ok) {
      const detail = payload && "error" in payload ? payload.error : undefined;
      const message = typeof detail === "string" ? detail : detail?.message;
      throw new Error(message || `fal.ai request failed (${response.status})`);
    }
    if (!payload) throw new Error("fal.ai returned an empty response");
    return payload;
  }

  return {
    async submit(modelPath: string, input: Record<string, unknown>): Promise<FalSubmission> {
      const payload = await request(`${FAL_QUEUE_ORIGIN}/${modelPath}`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!("request_id" in payload) || typeof payload.request_id !== "string")
        throw new Error("fal.ai did not return a request ID");
      return payload as FalSubmission;
    },
    async status(modelPath: string, requestId: string): Promise<{
      state: "pending" | "succeeded" | "failed";
      outputUrl?: string;
      error?: string;
      raw: FalStatus;
    }> {
      const statusUrl = `${FAL_QUEUE_ORIGIN}/${modelPath}/requests/${encodeURIComponent(requestId)}/status`;
      const status = (await request(statusUrl)) as FalStatus;
      if (status.status === "FAILED") {
        const detail = typeof status.error === "string" ? status.error : status.error?.message;
        return { state: "failed", error: detail || "fal.ai generation failed", raw: status };
      }
      if (status.status !== "COMPLETED") return { state: "pending", raw: status };
      const resultUrl = `${FAL_QUEUE_ORIGIN}/${modelPath}/requests/${encodeURIComponent(requestId)}`;
      const result = (await request(resultUrl)) as FalStatus;
      const url = outputUrl(result);
      if (!url) return { state: "failed", error: "fal.ai completed without a video URL", raw: result };
      return { state: "succeeded", outputUrl: url, raw: result };
    },
    async cancel(modelPath: string, requestId: string, cancelUrl?: string): Promise<void> {
      const url = cancelUrl || `${FAL_QUEUE_ORIGIN}/${modelPath}/requests/${encodeURIComponent(requestId)}/cancel`;
      await request(url, { method: "PUT" });
    },
  };
}
