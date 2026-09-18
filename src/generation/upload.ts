import { createClient } from "@supabase/supabase-js";

export async function uploadMedia(file: File): Promise<{ url: string }> {
  if (file.size > 100 * 1024 * 1024) throw new Error("Files must be smaller than 100 MB");
  const res = await fetch("/api/blob", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  if (res.status === 401) throw new Error("Sign in at /ads/login before uploading");
  if (!res.ok) throw new Error("Media storage is unavailable. Check the storage setup and try again.");
  const { bucket, pathname, token, url } = (await res.json()) as {
    bucket?: unknown;
    pathname?: unknown;
    token?: unknown;
    url?: unknown;
  };
  if (
    typeof bucket !== "string" ||
    typeof pathname !== "string" ||
    typeof token !== "string" ||
    typeof url !== "string"
  ) {
    throw new Error("Failed to retrieve the upload token");
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey)
    throw new Error("Media storage is unavailable");
  const storage = createClient(supabaseUrl, publishableKey).storage.from(bucket);
  const { error } = await storage.uploadToSignedUrl(pathname, token, file, {
    contentType: file.type,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { url };
}
