import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { loadE2EFixtures } from "./loadFixtures";

test.describe.configure({ mode: "serial" });

async function loginProfessional(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await expect(page.locator("#email")).toBeVisible();
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  const loginError = page.getByRole("alert");
  await expect(page.getByText("Pacientes ativos").or(loginError)).toBeVisible({ timeout: 30_000 });
  if (await loginError.isVisible()) {
    throw new Error("login recusado — confirme que o app E2E usa o stack local, não produção");
  }
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

test("owner storageState via UI email/password", async ({ page }) => {
  const fixtures = loadE2EFixtures();
  mkdirSync("playwright/.auth", { recursive: true });
  await loginProfessional(page, fixtures.emails.owner, fixtures.password);
  await page.context().storageState({ path: "playwright/.auth/professional-owner.json" });
});

test("member storageState via UI email/password", async ({ page }) => {
  const fixtures = loadE2EFixtures();
  mkdirSync("playwright/.auth", { recursive: true });
  await loginProfessional(page, fixtures.emails.professional, fixtures.password);
  await page.context().storageState({ path: "playwright/.auth/professional-member.json" });
});
