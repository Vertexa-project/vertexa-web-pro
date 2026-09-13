import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fixtures = vi.hoisted(() => ({
  emptyIdentity: {
    clinicId: "c1",
    exists: false,
    isComplete: false,
    legalName: null as string | null,
    taxId: null as string | null,
    taxIdMasked: null as string | null,
    email: null as string | null,
    mobilePhone: null as string | null,
    updatedAt: null as string | null,
  },
  savedIdentity: {
    clinicId: "c1",
    exists: true,
    isComplete: true,
    legalName: "Clínica Sintética LTDA",
    taxId: "99991111140",
    taxIdMasked: "***.***.***-40",
    email: "bill@t.test",
    mobilePhone: null as string | null,
    updatedAt: "2026-09-12T00:00:00Z",
  },
  isClinicAdmin: true,
  adminLoading: false,
  profileLoading: false,
  profileError: false,
  exists: false,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({
    isClinicAdmin: fixtures.isClinicAdmin,
    isLoading: fixtures.adminLoading,
    isError: false,
  }),
}));
vi.mock("@/hooks/useBillingProfile", () => ({
  useClinicBillingIdentity: () => ({
    data: fixtures.exists ? fixtures.savedIdentity : fixtures.emptyIdentity,
    isLoading: fixtures.profileLoading,
    isError: fixtures.profileError,
  }),
  useUpsertClinicBillingIdentity: () => ({
    mutate: fixtures.mutate,
    isPending: false,
  }),
}));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));

const { BillingProfilePage } = await import("./BillingProfilePage");

describe("BillingProfilePage", () => {
  beforeEach(() => {
    fixtures.isClinicAdmin = true;
    fixtures.adminLoading = false;
    fixtures.profileLoading = false;
    fixtures.profileError = false;
    fixtures.exists = false;
    fixtures.mutate.mockReset();
  });

  it("nega acesso ao não-admin sem expor documento", async () => {
    fixtures.isClinicAdmin = false;
    render(<BillingProfilePage />);
    expect(screen.getByText(/apenas o administrador da clínica/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/cpf ou cnpj/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/asaas|billing_customer|rpc/i)).not.toBeInTheDocument();
  });

  it("mostra formulário vazio para admin e valida CPF", async () => {
    const user = userEvent.setup();
    render(<BillingProfilePage />);
    expect(
      screen.getByText(/esses dados serão usados para faturamento e cobrança/i),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/nome ou razão social/i), "Clínica Alfa");
    await user.type(screen.getByLabelText(/cpf ou cnpj/i), "11111111111");
    await user.type(screen.getByLabelText(/e-mail de cobrança/i), "bill@t.test");
    await user.click(screen.getByRole("button", { name: /salvar dados de faturamento/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/cpf ou cnpj inválido/i);
    expect(fixtures.mutate).not.toHaveBeenCalled();
  });

  it("salva valores normalizados e não mostra seletor de pagamento", async () => {
    const user = userEvent.setup();
    render(<BillingProfilePage />);
    await user.type(screen.getByLabelText(/nome ou razão social/i), "Clínica Alfa");
    await user.type(screen.getByLabelText(/cpf ou cnpj/i), "999.911.111-40");
    await user.type(screen.getByLabelText(/e-mail de cobrança/i), "  BILL@T.TEST ");
    await user.click(screen.getByRole("button", { name: /salvar dados de faturamento/i }));
    expect(fixtures.mutate).toHaveBeenCalledWith(
      {
        legalName: "Clínica Alfa",
        taxId: "99991111140",
        email: "bill@t.test",
        mobilePhone: null,
      },
      expect.any(Object),
    );
    expect(screen.queryByText(/assinatura agora|qr code|cartão/i)).not.toBeInTheDocument();
  });

  it("mascara o CPF depois de salvo", async () => {
    fixtures.exists = true;
    render(<BillingProfilePage />);
    expect(screen.getByText("***.***.***-40")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("99991111140")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /editar/i })).toBeInTheDocument();
  });
});
