import { expect, test } from "@playwright/test";

test("profissional convidado entra na clínica sem virar owner/PA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Pacientes ativos")).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Dashboard da plataforma")).toHaveCount(0);
});
