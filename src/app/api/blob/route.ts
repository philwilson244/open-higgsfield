import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/supabase/server";
import { blobPathname } from "@/generation/device";

export async function POST(request: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid upload request" },
      { status: 400 },
    );
  }
  if (
    !body ||
    !["blob.generate-client-token", "blob.upload-completed"].includes(body.type)
  )
    return NextResponse.json(
      { error: "Invalid upload event" },
      { status: 400 },
    );
  if (body.type === "blob.generate-client-token") {
    try {
      const { user } = await requireAccount();
      if (!body.payload || typeof body.payload.pathname !== "string")
        return NextResponse.json(
          { error: "Missing file name" },
          { status: 400 },
        );
      body = {
        ...body,
        payload: {
          ...body.payload,
          pathname: blobPathname(user.id, body.payload.pathname),
        },
      };
    } catch {
      return NextResponse.json(
        { error: "Sign in at /ads/login to upload" },
        { status: 401 },
      );
    }
  }
  // Completion callbacks have no browser session; handleUpload verifies their signature.
  try {
    const token = process.env.OPEN_HIGGSFIELD_READ_WRITE_TOKEN;
    if (!token)
      return NextResponse.json(
        { error: "Media storage is not configured" },
        { status: 503 },
      );
    const result = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "video/mp4",
          "audio/wav",
          "audio/x-wav",
        ],
        maximumSizeInBytes: 100 * 1024 * 1024,
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(
      result.type === "blob.generate-client-token" &&
        body.type === "blob.generate-client-token"
        ? { ...result, pathname: body.payload.pathname }
        : result,
    );
  } catch {
    return NextResponse.json(
      { error: "Upload could not be authorized" },
      { status: 400 },
    );
  }
}
