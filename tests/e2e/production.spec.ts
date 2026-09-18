import { expect, test } from "@playwright/test";

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const hasProductionAccount = Boolean(process.env.E2E_BASE_URL && email && password);

test.describe("authenticated production paths", () => {
  test.skip(!hasProductionAccount, "Set E2E_BASE_URL, E2E_USER_EMAIL, and E2E_USER_PASSWORD");

  test.beforeEach(async ({ page }) => {
    await page.goto("/ads/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/ads(?:\?|$)/);
  });

  test("authenticated media upload reaches object storage", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Videos" }).click();

    const uploadAuthorization = page.waitForResponse((response) =>
      response.url().endsWith("/api/blob") && response.request().method() === "POST",
    );
    const objectUpload = page.waitForResponse((response) =>
      response.url().includes("/storage/v1/object/upload/sign/") &&
      ["POST", "PUT"].includes(response.request().method()),
    );

    await page.locator('input[type="file"]').setInputFiles({
      name: `production-upload-${Date.now()}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });

    expect((await uploadAuthorization).status()).toBe(200);
    expect((await objectUpload).ok()).toBeTruthy();
    await expect(page.getByText(/Upload failed/i)).toHaveCount(0);
  });

  test("paid generation can be submitted and canceled", async ({ page }) => {
    test.skip(
      process.env.E2E_RUN_PAID_GENERATION !== "1",
      "Paid generation is intentionally opt-in",
    );
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Edit platform key" })).toBeVisible();
    await page.getByLabel("Prompt").fill(`Production cancellation check ${Date.now()}`);
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true }).first();
    await expect(cancel).toBeVisible({ timeout: 45_000 });
    await cancel.click();
    await expect(cancel).toHaveCount(0, { timeout: 30_000 });
  });
});
