import { expect, test } from "@playwright/test";

import { loadE2EFixtures } from "./loadFixtures";

test("owner autenticado vê clínica e dashboard", async ({ page }) => {
  const fixtures = loadE2EFixtures();
  await page.goto("/");
  await expect(page.getByText("Pacientes ativos")).toBeVisible();
  await expect(page.getByRole("link", { name: "Pacientes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Configurações" })).toBeVisible();
  await expect(page.getByText("Dashboard da plataforma")).toHaveCount(0);
  await page.goto("/pacientes");
  await expect(page.getByRole("link", { name: "Pacientes" })).toBeVisible();
  expect(fixtures.ids.clinic_id).toBeTruthy();
});
