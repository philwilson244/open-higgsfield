import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3137",
  ],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const origin = "http://127.0.0.1:3137";
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Preview server startup timed out")),
      25000,
    );
    server.on("error", reject);
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited (${code})`));
    });
    server.stdout.on("data", (value) => {
      if (String(value).includes("Ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (value) => process.stderr.write(value));
  });
  const page = await fetch(`${origin}/ads`, {
    headers: { Cookie: "api_key=old-raw-value" },
  });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control"), /no-store/);
  assert.match(page.headers.get("set-cookie"), /api_key=;.*Max-Age=0/i);
  const html = await page.text();
  for (const text of [
    "Preview mode",
    "The creative brief",
    "Build concepts",
    "Fullcourt example",
    "Provider settings",
  ])
    assert.ok(html.includes(text), `Missing ${text}`);
  console.log(
    "PASS /ads renders preview and never caches account pages or retains raw keys",
  );
  const login = await fetch(`${origin}/ads/login`, { redirect: "manual" });
  assert.equal(login.status, 307);
  assert.equal(login.headers.get("location"), "/ads");
  console.log("PASS unconfigured login returns to clearly labeled preview");
  for (const [path, body] of [
    ["/api/ad-plan", {}],
    [
      "/api/blob",
      { type: "blob.generate-client-token", payload: { pathname: "test.png" } },
    ],
  ]) {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 401);
    assert.ok((await response.json()).error);
    console.log(`PASS ${path} denies unauthenticated requests`);
  }
  const bad = await fetch(`${origin}/api/blob`, {
    method: "POST",
    body: "invalid",
  });
  assert.equal(bad.status, 400);
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.ok((await home.text()).includes('href="/ads"'));
  console.log(
    "PASS malformed upload fails cleanly; existing studio links to Ad Studio",
  );
} finally {
  server.kill("SIGTERM");
}
