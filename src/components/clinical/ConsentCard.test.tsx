import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConsentCard } from "./ConsentCard";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/clinical/consent";

describe("ConsentCard", () => {
  it("só habilita o aceite depois de marcar a caixa e envia versão e texto", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConsentCard onConfirm={onConfirm} error={null} />);
    const btn = screen.getByRole("button", { name: "Registrar aceite" });
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith(CONSENT_VERSION, CONSENT_TEXT);
  });
});
