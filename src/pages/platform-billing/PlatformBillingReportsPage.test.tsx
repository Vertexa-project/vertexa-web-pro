import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PlatformBillingReportsPage } from "./PlatformBillingReportsPage";

describe("PlatformBillingReportsPage", () => {
  it("does not pretend CSV export exists", () => {
    render(<PlatformBillingReportsPage />);
    expect(screen.getByText("Relatórios em breve")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /csv|exportar/i })).not.toBeInTheDocument();
  });
});
