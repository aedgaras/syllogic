import { expect, test, type Page, type TestInfo } from "@playwright/test";

type SmokeRoute = {
  name: string;
  path: string;
  needsEnv?: string;
};

const route = (name: string, path: string, needsEnv?: string): SmokeRoute => ({
  name,
  path,
  needsEnv,
});

const routes: SmokeRoute[] = [
  route("dashboard", "/"),
  route("transactions", "/transactions"),
  route(
    "account-detail",
    `/accounts/${process.env.PLAYWRIGHT_ACCOUNT_ID || ""}`,
    "PLAYWRIGHT_ACCOUNT_ID",
  ),
  route("subscriptions", "/subscriptions"),
  route("investments", "/investments"),
  route("assets", "/assets"),
  route("reports", "/reports"),
  route("settings", "/settings"),
  route(
    "import-mapping",
    `/transactions/import/mapping?importId=${
      process.env.PLAYWRIGHT_IMPORT_ID || ""
    }`,
    "PLAYWRIGHT_IMPORT_ID",
  ),
  route(
    "import-preview",
    `/transactions/import/preview?importId=${
      process.env.PLAYWRIGHT_IMPORT_ID || ""
    }`,
    "PLAYWRIGHT_IMPORT_ID",
  ),
];

async function login(page: Page) {
  const email =
    process.env.PLAYWRIGHT_TEST_EMAIL || process.env.NEXT_PUBLIC_DEMO_EMAIL;
  const password =
    process.env.PLAYWRIGHT_TEST_PASSWORD ||
    process.env.NEXT_PUBLIC_DEMO_PASSWORD;

  test.skip(
    !email || !password,
    "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD, or the NEXT_PUBLIC_DEMO_* credentials.",
  );
  if (!email || !password) {
    return;
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /login/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function assertNoHorizontalOverflow(page: Page) {
  const { viewportWidth, scrollWidth, bodyScrollWidth } = await page.evaluate(
    () => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }),
  );

  expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth);
}

async function captureScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = await page.screenshot({
    fullPage: true,
    animations: "disabled",
  });

  await testInfo.attach(`${testInfo.project.name}-${name}`, {
    body: screenshot,
    contentType: "image/png",
  });
}

test.describe("authenticated mobile layout smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const smokeRoute of routes) {
    test(`${smokeRoute.name} has no horizontal overflow`, async ({
      page,
    }, testInfo) => {
      test.skip(
        !!smokeRoute.needsEnv && !process.env[smokeRoute.needsEnv],
        `Set ${smokeRoute.needsEnv} to include ${smokeRoute.name} in smoke coverage.`,
      );

      await page.goto(smokeRoute.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body")).toBeVisible();

      await assertNoHorizontalOverflow(page);
      await captureScreenshot(page, testInfo, smokeRoute.name);
    });
  }
});
