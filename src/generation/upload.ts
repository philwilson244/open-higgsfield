import { put } from "@vercel/blob/client";

export async function uploadMedia(file: File): Promise<{ url: string }> {
  if (file.size > 100 * 1024 * 1024) throw new Error("Files must be smaller than 100 MB");
  const res = await fetch("/api/blob", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname: file.name, clientPayload: null, multipart: false },
    }),
  });
  if (res.status === 401) throw new Error("Sign in at /ads/login before uploading");
  if (!res.ok) throw new Error("Media storage is unavailable. Check the storage setup and try again.");
  const { clientToken, pathname } = (await res.json()) as {
    clientToken?: unknown;
    pathname?: unknown;
  };
  if (typeof clientToken !== "string" || typeof pathname !== "string") {
    throw new Error("Failed to retrieve the client token");
  }
  const blob = await put(pathname, file, { access: "public", token: clientToken });
  return { url: blob.url };
}
