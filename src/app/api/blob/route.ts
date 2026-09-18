import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/supabase/server";
import { blobPathname } from "@/generation/device";

const MEDIA_BUCKET = "ad-media";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/wav",
  "audio/x-wav",
]);

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid upload request" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object")
    return NextResponse.json(
      { error: "Invalid upload request" },
      { status: 400 },
    );

  const { filename, contentType, size } = body as Record<string, unknown>;
  if (
    typeof filename !== "string" ||
    typeof contentType !== "string" ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0
  )
    return NextResponse.json(
      { error: "File name, type, and size are required" },
      { status: 400 },
    );
  if (!ALLOWED_CONTENT_TYPES.has(contentType))
    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  if (size > MAX_UPLOAD_BYTES)
    return NextResponse.json(
      { error: "Files must be smaller than 100 MB" },
      { status: 413 },
    );

  try {
    const { db, user } = await requireAccount();
    const pathname = blobPathname(
      user.id,
      `${crypto.randomUUID()}-${filename}`,
    );
    const { data, error } = await db.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(pathname);
    if (error) throw error;
    const { data: publicAsset } = db.storage
      .from(MEDIA_BUCKET)
      .getPublicUrl(pathname);
    return NextResponse.json({
      bucket: MEDIA_BUCKET,
      pathname,
      token: data.token,
      url: publicAsset.publicUrl,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Sign in"))
      return NextResponse.json(
        { error: "Sign in at /ads/login to upload" },
        { status: 401 },
      );
    console.error("Could not authorize media upload", error);
    return NextResponse.json(
      { error: "Media storage is unavailable" },
      { status: 503 },
    );
  }
}
