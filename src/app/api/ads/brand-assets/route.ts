import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccount } from "@/lib/supabase/server";

const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxSize = 10 * 1024 * 1024;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > maxSize + 100_000)
    return NextResponse.json({ error: "Brand images must be under 10 MB." }, { status: 413 });
  try {
    const { db, user } = await requireAccount();
    const form = await request.formData();
    const brandId = z.uuid().parse(form.get("brandId"));
    const kind = z.enum(["logo", "reference", "screenshot"]).parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File) || !allowed.has(file.type) || file.size < 1 || file.size > maxSize)
      return NextResponse.json({ error: "Choose a PNG, JPEG, or WebP image under 10 MB." }, { status: 400 });
    const { data: brand } = await db.from("ad_brands").select("id")
      .eq("id", brandId).eq("owner_id", user.id).maybeSingle();
    if (!brand) return NextResponse.json({ error: "Save the brand kit before adding files." }, { status: 404 });
    const { error: quotaError } = await db.rpc("consume_ad_quota", {
      p_action: "upload", p_units: file.size, p_cost_cents: 0,
    });
    if (quotaError) throw new Error(quotaError.message);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const looksPng = file.type === "image/png" && bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) =>
      byte === [137, 80, 78, 71, 13, 10, 26, 10][index]);
    const looksJpeg = file.type === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const looksWebp = file.type === "image/webp" && bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
    if (!looksPng && !looksJpeg && !looksWebp)
      return NextResponse.json({ error: "The image file does not match its selected type." }, { status: 400 });
    const filename = file.name.slice(0, 255) || `brand-image.${file.type.split("/")[1]}`;
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${user.id}/brands/${brandId}/${crypto.randomUUID()}.${extension}`;
    const uploaded = await db.storage.from("ad-production").upload(path, bytes, {
      contentType: file.type, upsert: false,
    });
    if (uploaded.error) throw uploaded.error;
    const { data, error } = await db.from("ad_assets").insert({
      owner_id: user.id, brand_id: brandId, kind,
      storage_bucket: "ad-production", storage_path: path,
      filename, mime_type: file.type, size_bytes: file.size,
    }).select("id").single();
    if (error) {
      await db.storage.from("ad-production").remove([path]);
      throw error;
    }
    return NextResponse.json({ id: data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not upload the brand image.";
    if (message.includes("Sign in")) return NextResponse.json({ error: message }, { status: 401 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid brand or image type." }, { status: 400 });
    if (message.includes("quota") || message.includes("Rate limit")) return NextResponse.json({ error: message }, { status: 429 });
    return NextResponse.json({ error: "Could not upload the brand image." }, { status: 503 });
  }
}
