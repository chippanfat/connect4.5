import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  test,
} from "@playwright/test";

async function signUpAndVerify(
  page: Page,
  request: APIRequestContext,
  username: string,
  email: string,
) {
  await page.goto("/sign-up");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  let verificationUrl = "";
  await expect
    .poll(async () => {
      const listResponse = await request.get("http://localhost:8025/api/v1/messages");
      if (!listResponse.ok()) return "";
      const list = (await listResponse.json()) as {
        messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
      };
      const message = list.messages.find((item) =>
        item.To.some((recipient) => recipient.Address === email),
      );
      if (!message) return "";
      const detailResponse = await request.get(
        `http://localhost:8025/api/v1/message/${message.ID}`,
      );
      const detail = (await detailResponse.json()) as { Text?: string; HTML?: string };
      const match = `${detail.Text ?? ""} ${detail.HTML ?? ""}`.match(
        /https?:\/\/[^\s"<]+\/api\/auth\/verify-email\?[^\s"<]+/,
      );
      verificationUrl = match?.[0]?.replaceAll("&amp;", "&") ?? "";
      return verificationUrl;
    })
    .not.toBe("");

  await page.goto(verificationUrl);
  await page.waitForURL(/\/dashboard/);
}

async function playColumn(page: Page, column: number) {
  await page.getByRole("button", { name: new RegExp(`Drop a disc in column ${column}`) }).click();
  await expect(page.getByText(/Your turn|is thinking|You won|won$/).first()).toBeVisible();
}

test("two verified players can finish a private game and start a rematch", async ({
  browser,
  request,
}) => {
  test.skip(!process.env.RUN_FULL_E2E, "Set RUN_FULL_E2E=1 with local infrastructure running.");
  const suffix = Date.now().toString(36);
  const hostContext: BrowserContext = await browser.newContext();
  const guestContext: BrowserContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await signUpAndVerify(host, request, `host_${suffix}`, `host-${suffix}@example.test`);
  await signUpAndVerify(guest, request, `guest_${suffix}`, `guest-${suffix}@example.test`);

  await host.goto("/dashboard");
  const responsePromise = host.waitForResponse(
    (response) => response.url().endsWith("/api/games") && response.request().method() === "POST",
  );
  await host.getByRole("button", { name: "New private game" }).click();
  const createPayload = (await (await responsePromise).json()) as { data: { inviteUrl: string } };
  await guest.goto(createPayload.data.inviteUrl);
  await guest.getByRole("button", { name: "Join the game" }).click();
  await expect(guest).toHaveURL(/\/game\//);
  await expect(host.getByText(/Your turn|is thinking/).first()).toBeVisible();

  const secondHostTab = await hostContext.newPage();
  await secondHostTab.goto(host.url());
  await expect(secondHostTab.getByText("Live", { exact: true })).toBeVisible();
  await secondHostTab.close();
  await guest.reload();
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();

  const hostIsRed = (await host.locator(".player-panel--left .avatar-disc--red").count()) === 1;
  const red = hostIsRed ? host : guest;
  const yellow = hostIsRed ? guest : host;
  const firstColumn = red.getByRole("button", { name: /Drop a disc in column 1/ });
  await firstColumn.focus();
  await red.keyboard.press("Enter");
  await expect(red.getByText(/Your turn|is thinking/).first()).toBeVisible();
  await playColumn(yellow, 7);
  await playColumn(red, 2);
  await playColumn(yellow, 7);
  await playColumn(red, 3);
  await playColumn(yellow, 6);
  await playColumn(red, 4);
  await expect(red.locator(".game-status").getByText("You won!", { exact: true })).toBeVisible();

  const previousRedUrl = red.url();
  const previousYellowUrl = yellow.url();
  await red.getByRole("button", { name: "Request rematch" }).click();
  await yellow.getByRole("button", { name: "Request rematch" }).click();
  await expect.poll(() => red.url()).not.toBe(previousRedUrl);
  await expect.poll(() => yellow.url()).not.toBe(previousYellowUrl);
  await expect(red).toHaveURL(/\/game\//);
  await expect(yellow).toHaveURL(/\/game\//);
  await hostContext.close();
  await guestContext.close();
});

test("the server clock finishes a disconnected player's turn", async ({
  browser,
  browserName,
  request,
}) => {
  test.skip(
    !process.env.RUN_FULL_E2E || browserName !== "chromium",
    "The clock smoke test runs once in Chromium with local infrastructure.",
  );
  const suffix = Date.now().toString(36);
  const hostUsername = `clock_host_${suffix}`;
  const guestUsername = `clock_guest_${suffix}`;
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await signUpAndVerify(host, request, hostUsername, `${hostUsername}@example.test`);
  await signUpAndVerify(guest, request, guestUsername, `${guestUsername}@example.test`);

  await host.goto("/dashboard");
  await host.getByLabel("Turn clock").selectOption("30");
  const createResponse = host.waitForResponse(
    (response) => response.url().endsWith("/api/games") && response.request().method() === "POST",
  );
  await host.getByRole("button", { name: "New private game" }).click();
  const created = (await (await createResponse).json()) as { data: { inviteUrl: string } };
  await guest.goto(created.data.inviteUrl);
  const joinResponse = guest.waitForResponse(
    (response) => response.url().endsWith("/join") && response.request().method() === "POST",
  );
  await guest.getByRole("button", { name: "Join the game" }).click();
  const active = (await (await joinResponse).json()) as {
    data: { currentTurnUserId: string; players: Array<{ userId: string; username: string }> };
  };
  const hostId = active.data.players.find((player) => player.username === hostUsername)!.userId;
  const winner = active.data.currentTurnUserId === hostId ? guest : host;

  await expect(
    winner.locator(".game-status").getByText("You won on time", { exact: true }),
  ).toBeVisible({
    timeout: 40_000,
  });
  await hostContext.close();
  await guestContext.close();
});
