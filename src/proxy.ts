import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { databaseConfigured } from "./lib/supabase/config";

import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_OPTIONS,
  resolveDeviceId,
} from "./generation/device";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (databaseConfigured()) {
    const db = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(values, cacheHeaders) {
            values.forEach(({ name, value }) =>
              request.cookies.set(name, value),
            );
            response = NextResponse.next({ request });
            values.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
            Object.entries(cacheHeaders ?? {}).forEach(([name, value]) =>
              response.headers.set(name, value),
            );
          },
        },
      },
    );
    await db.auth.getUser();
  }
  const { deviceId, minted } = resolveDeviceId(
    request.cookies.get(DEVICE_COOKIE)?.value,
  );
  if (minted)
    response.cookies.set(DEVICE_COOKIE, deviceId, DEVICE_COOKIE_OPTIONS);
  // Authenticated pages and cookie-refresh responses must never enter shared caches.
  response.headers.set("Cache-Control", "private, no-store");
  // Old raw-key cookies are intentionally not imported into another account.
  if (request.cookies.has("api_key"))
    response.cookies.set("api_key", "", { path: "/", maxAge: 0 });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
