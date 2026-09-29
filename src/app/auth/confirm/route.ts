import { NextResponse } from "next/server";
import { database } from "@/lib/supabase/server";
import {
  parseEmailOtpType,
  safeAuthDestination,
} from "@/lib/auth/confirmation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = safeAuthDestination(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = parseEmailOtpType(url.searchParams.get("type"));

  try {
    const db = await database();
    if (tokenHash && type) {
      const { error } = await db.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (!error) return NextResponse.redirect(new URL(destination, url.origin));
    } else if (code) {
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(destination, url.origin));
    }
  } catch {
    // The login page provides a safe retry path without exposing auth internals.
  }

  return NextResponse.redirect(
    new URL("/ads/login?error=confirmation", url.origin),
  );
}
