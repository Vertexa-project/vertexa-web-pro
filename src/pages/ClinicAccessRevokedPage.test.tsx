import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { ClinicMembership } from "@/lib/api/professionalStatus";

/**
 * AS DUAS TELAS QUE EXPLICAM (WP-FRONT-2bii-A item 3) — cobertura de FIAÇÃO.
 *
 * A DECISÃO já é testada por função pura (`resolveClinicAccess`): quando é "desativado", quando é
 * "sem clínica", e o fail-open em erro. O que nenhuma função pura alcança, e é o que este arquivo
 * cobre, é o que a pessoa LÊ: se o nome da clínica aparece, se as duas telas dizem coisas
 * DIFERENTES (uma afirma um corte, a outra afirma cadastro incompleto) e se o botão de sair
 * chama mesmo o signOut.
 */

const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }));
vi.mock("@/providers/auth-context", () => ({ useAuth: () => ({ signOut: auth.signOut }) }));
vi.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => ({ email: "bruno@clinica.test" }),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

const { ClinicAccessRevokedPage, NoClinicMembershipPage } = await import("./ClinicAccessRevokedPage");

function clinic(name: string, status = "inactive"): ClinicMembership {
  return { clinicId: `c-${name}`, clinicName: name, status };
}

function renderRevoked(clinics: ClinicMembership[]) {
  return render(
    <MemoryRouter>
      <ClinicAccessRevokedPage clinics={clinics} />
    </MemoryRouter>,
  );
}

describe("ClinicAccessRevokedPage — 'fui desativado'", () => {
  it("NOMEIA a clínica que desativou o acesso", () => {
    renderRevoked([clinic("Clínica Vida Ativa")]);

    expect(screen.getByText("Seu acesso foi desativado")).toBeInTheDocument();
    expect(screen.getByText("Clínica Vida Ativa")).toBeInTheDocument();
  });

  it("diz que a CONTA continua existindo — desativar não é apagar", () => {
    renderRevoked([clinic("Clínica Vida Ativa")]);
    expect(screen.getByText(/sua conta continua existindo/i)).toBeInTheDocument();
    expect(screen.getByText("bruno@clinica.test")).toBeInTheDocument();
  });

  it("manda falar com o administrador, que é quem pode reativar", () => {
    renderRevoked([clinic("Clínica Vida Ativa")]);
    expect(screen.getByText(/só ele pode reativar o seu acesso/i)).toBeInTheDocument();
  });

  it("diz que o histórico fica com a autoria (não promete apagamento nem perda)", () => {
    renderRevoked([clinic("Clínica Vida Ativa")]);
    expect(screen.getByText(/desativar não apaga histórico/i)).toBeInTheDocument();
  });

  // Com mais de uma clínica o texto muda de forma: não escolhe uma como "a" clínica.
  it("com duas clínicas, cita as duas e não elege uma", () => {
    renderRevoked([clinic("Clínica Alfa"), clinic("Clínica Beta")]);
    expect(screen.getByText(/clínica alfa, clínica beta/i)).toBeInTheDocument();
  });

  it("o botão Sair chama signOut e leva ao login", async () => {
    const user = userEvent.setup();
    renderRevoked([clinic("Clínica Vida Ativa")]);

    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});

describe("NoClinicMembershipPage — 'não tenho clínica' é OUTRA coisa", () => {
  it("afirma cadastro incompleto, e NEGA explicitamente que seja desativação", () => {
    render(
      <MemoryRouter>
        <NoClinicMembershipPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Sua conta não está em nenhuma clínica")).toBeInTheDocument();
    expect(screen.getByText(/isso não é uma desativação: é cadastro incompleto/i)).toBeInTheDocument();
  });

  // O ponto do item 3: as duas ausências não podem virar a mesma tela.
  it("NÃO usa o texto da desativação (as duas telas dizem coisas diferentes)", () => {
    render(
      <MemoryRouter>
        <NoClinicMembershipPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Seu acesso foi desativado")).not.toBeInTheDocument();
    expect(screen.queryByText(/só ele pode reativar o seu acesso/i)).not.toBeInTheDocument();
  });
});
