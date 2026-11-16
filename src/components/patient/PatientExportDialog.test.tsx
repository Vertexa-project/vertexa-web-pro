import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ exportPatients: vi.fn() }));
const dl = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("@/lib/api/patientImportExport", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/patientImportExport")>("@/lib/api/patientImportExport");
  return { ...actual, exportPatients: api.exportPatients };
});
vi.mock("@/lib/domain/tableExport", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domain/tableExport")>("@/lib/domain/tableExport");
  return { ...actual, downloadBlob: dl.downloadBlob };
});

const { PatientExportDialog } = await import("./PatientExportDialog");

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PatientExportDialog open onOpenChange={vi.fn()} clinicId="c1" patientCount={4} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.exportPatients.mockReset().mockResolvedValue({
    export_id: "e1",
    row_count: 2,
    rows: [
      { nome: "Mariana Teste", email: "paciente1.teste@dizeops.com", nascimento: "1990-05-10", peso_atual: 68.2 },
      { nome: "Ana (QA)", email: "ana.qa@dizeops.com", nascimento: null, peso_atual: null },
    ],
  });
  dl.downloadBlob.mockReset();
});

const exportBtn = () => screen.getByRole("button", { name: "Exportar" });

describe("PatientExportDialog", () => {
  it("mostra os grupos de dados, a regra do prontuário e a contagem", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Exportar base de pacientes" })).toBeInTheDocument();
    expect(screen.getByText(/4 pacientes · padrão brasileiro, com vírgula decimal/)).toBeInTheDocument();
    for (const l of ["Cadastro", "Contato", "Medidas e peso", "Adesão"]) expect(screen.getByLabelText(l)).toBeChecked();
    expect(screen.getByText(/Prontuário não entra na base: sai paciente a paciente, em PDF\./)).toBeInTheDocument();
    expect(screen.getByText(/Só o papel Gestor exporta/)).toBeInTheDocument();
  });

  it("motivo é obrigatório: sem escolher o tipo e sem texto não chama o servidor nem baixa", async () => {
    renderDialog();
    await userEvent.click(exportBtn());
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha o motivo da exportação.");
    await userEvent.selectOptions(screen.getByLabelText("Motivo da exportação"), "backup");
    // o aviso antigo some assim que a pessoa corrige (achado D70)
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(exportBtn());
    expect(screen.getByRole("alert")).toHaveTextContent(/mínimo de 5 letras/);
    await userEvent.type(screen.getByLabelText("Explique em poucas palavras"), "abc");
    await userEvent.click(exportBtn());
    expect(screen.getByRole("alert")).toHaveTextContent(/mínimo de 5 letras/);
    expect(api.exportPatients).not.toHaveBeenCalled();
    expect(dl.downloadBlob).not.toHaveBeenCalled();
  });

  it("sem nenhum grupo marcado não exporta", async () => {
    renderDialog();
    for (const l of ["Cadastro", "Contato", "Medidas e peso", "Adesão"]) await userEvent.click(screen.getByLabelText(l));
    await userEvent.selectOptions(screen.getByLabelText("Motivo da exportação"), "backup");
    await userEvent.type(screen.getByLabelText("Explique em poucas palavras"), "Backup mensal");
    await userEvent.click(exportBtn());
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha ao menos um grupo de dados.");
    expect(api.exportPatients).not.toHaveBeenCalled();
  });

  it("exporta: manda grupos e motivo, baixa o CSV com BOM e mostra o registro", async () => {
    renderDialog();
    await userEvent.click(screen.getByLabelText("Medidas e peso"));
    await userEvent.selectOptions(screen.getByLabelText("Motivo da exportação"), "migracao");
    await userEvent.type(screen.getByLabelText("Explique em poucas palavras"), "  Migração para o sistema novo ");
    await userEvent.click(exportBtn());
    expect(await screen.findByRole("status")).toHaveTextContent("Exportação registrada: 2 pacientes.");
    expect(api.exportPatients).toHaveBeenCalledWith("c1", ["cadastro", "contato", "adesao"], "migracao", "  Migração para o sistema novo ");
    expect(dl.downloadBlob).toHaveBeenCalledTimes(1);
    const [csv, filename, mime] = dl.downloadBlob.mock.calls[0];
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Nome;Nascimento;Sexo;Objetivo;Início do acompanhamento;Origem;E-mail;Telefone;Status;Pontuação;Adesão da semana (%)");
    expect(csv).toContain("Mariana Teste;10/05/1990");
    expect(csv).not.toContain("Peso");
    expect(filename).toMatch(/^pacientes_vertexa_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mime).toMatch(/csv/);
    expect(screen.getByText(/Registrado em Configurações › Exportações da base de pacientes/)).toBeInTheDocument();
  });

  it("se o servidor recusar (ex.: não é Gestor), mostra a mensagem e não baixa nada", async () => {
    api.exportPatients.mockRejectedValue({ hint: "PATIENT_EXPORT_MANAGER_REQUIRED", message: "forbidden" });
    renderDialog();
    await userEvent.selectOptions(screen.getByLabelText("Motivo da exportação"), "backup");
    await userEvent.type(screen.getByLabelText("Explique em poucas palavras"), "Backup mensal");
    await userEvent.click(exportBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("Só o Gestor ou o administrador da clínica exporta a base.");
    expect(dl.downloadBlob).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
