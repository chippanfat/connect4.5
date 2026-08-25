import { expect, test } from "@playwright/test";

test("landing page presents the private game experience", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "One link. Two players. Four to win." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Play for free" })).toBeVisible();
  await expect(page.getByLabel("Preview of a Four in a Row game board")).toBeVisible();
});

test("serves installable app metadata and the push service worker", async ({ request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: "Four in a Row",
    display: "standalone",
    start_url: "/dashboard",
  });

  const serviceWorkerResponse = await request.get("/sw.js");
  expect(serviceWorkerResponse.ok()).toBe(true);
  expect(await serviceWorkerResponse.text()).toContain('self.addEventListener("push"');
});

test("account creation is keyboard accessible", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Username").focus();
  await expect(page.getByLabel("Username")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
});
