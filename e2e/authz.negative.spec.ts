import { expect, test } from "@playwright/test";

test("membro não ganha Platform Admin ao abrir /platform", async ({ page }) => {
  await page.goto("/platform");
  await expect(page.getByText("Pacientes ativos")).toBeVisible();
  await expect(page.getByText("Dashboard da plataforma")).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/platform(\/|$)/);
});
