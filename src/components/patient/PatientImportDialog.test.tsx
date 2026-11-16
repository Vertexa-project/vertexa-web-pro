import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getImportDedupeKeys: vi.fn(),
  importPatients: vi.fn(),
}));
vi.mock("@/lib/api/patientImportExport", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/patientImportExport")>("@/lib/api/patientImportExport");
  return { ...actual, getImportDedupeKeys: api.getImportDedupeKeys, importPatients: api.importPatients };
});

const { PatientImportDialog } = await import("./PatientImportDialog");

const CSV = [
  "Nome do Paciente;E-mail;Celular;Data de Nascimento;Peso (kg);grupo",
  "Marina Teles (QA);marina.qa@dizeops.com;(17) 99812-3344;10/05/1990;70,5;A",
  "Bruno Azevedo (QA);bruno.qa@dizeops.com;(17) 99701-2201;02/01/1985;88;A",
  "Clara Nunes (QA);clara.qa@dizeops.com;(16) 98888-1020;;66;B",
  "Mariana Teste;paciente1.teste@dizeops.com;;;;B",
  "Sem Email (QA);email-ruim;;;;B",
  "Data Ruim (QA);;;31/02/2000;;B",
].join("\n");

function csvFile(text = CSV, name = "pacientes_teste.csv") {
  const f = new File([text], name, { type: "text/csv" });
  Object.defineProperty(f, "arrayBuffer", { value: async () => new TextEncoder().encode(text).buffer });
  return f;
}

function renderDialog(onDone = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PatientImportDialog open onOpenChange={vi.fn()} clinicId="c1" onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onDone };
}

async function upload(file = csvFile()) {
  const input = screen.getByLabelText(/arquivo de pacientes/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("list", { name: "Colunas do arquivo" });
}

async function toPreview() {
  await userEvent.click(screen.getByRole("button", { name: "Conferir prévia" }));
  await screen.findByLabelText("Resumo da prévia");
}

beforeEach(() => {
  api.getImportDedupeKeys.mockReset().mockResolvedValue([
    { email: "paciente1.teste@dizeops.com", name: "Mariana Teste", birth_date: null, phone_key: null },
  ]);
  api.importPatients.mockReset().mockImplementation(async (_c: string, _f: string, rows: Array<{ line: number }>) => ({
    batch_id: "b1", imported: rows.length, duplicates: 0, errors: 0,
    results: rows.map((r) => ({ line: r.line, status: "importado", patient_id: `p${r.line}` })),
  }));
});

describe("PatientImportDialog", () => {
  it("passo 1: texto do protótipo e nada é gravado sem confirmação", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Importar pacientes" })).toBeInTheDocument();
    expect(screen.getByText(/Passo 1 de 3 · nada é gravado sem a sua confirmação/)).toBeInTheDocument();
    expect(screen.getByText("Solte aqui o CSV ou a planilha")).toBeInTheDocument();
    expect(screen.getByText("Exportado do Dietbox, WebDiet ou de uma planilha sua.")).toBeInTheDocument();
    expect(api.importPatients).not.toHaveBeenCalled();
  });

  it("passo 2: liga as colunas pelo cabeçalho e deixa 'grupo' sem campo", async () => {
    renderDialog();
    await upload();
    expect(screen.getByText(/Passo 2 de 3/)).toBeInTheDocument();
    const sel = (name: string) => screen.getByLabelText(`Campo para a coluna ${name}`) as HTMLSelectElement;
    expect(sel("Nome do Paciente").value).toBe("name");
    expect(sel("E-mail").value).toBe("email");
    expect(sel("Celular").value).toBe("phone");
    expect(sel("Data de Nascimento").value).toBe("birth_date");
    expect(sel("Peso (kg)").value).toBe("weight_kg");
    expect(sel("grupo").value).toBe("");
    expect(screen.getByText(/6 linhas · 6 colunas · 5 ligadas/)).toBeInTheDocument();
  });

  it("sem coluna de nome ligada não deixa conferir a prévia; ligar a mesma coluna a outro campo desliga a anterior", async () => {
    renderDialog();
    await upload();
    const nameSel = screen.getByLabelText("Campo para a coluna Nome do Paciente") as HTMLSelectElement;
    fireEvent.change(nameSel, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Conferir prévia" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Ligue uma coluna a “Nome completo”/);
    // ajuste manual: 'grupo' vira o nome; o campo só pode ter uma coluna
    fireEvent.change(screen.getByLabelText("Campo para a coluna grupo"), { target: { value: "name" } });
    expect(screen.getByRole("button", { name: "Conferir prévia" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Campo para a coluna E-mail"), { target: { value: "name" } });
    expect((screen.getByLabelText("Campo para a coluna grupo") as HTMLSelectElement).value).toBe("");
    expect(screen.getAllByText("Ajustada").length).toBeGreaterThan(0);
  });

  it("prévia: prontos, erro e duplicado marcados; duplicado de e-mail fica fora e não pode ser liberado", async () => {
    renderDialog();
    await upload();
    await toPreview();
    const summary = screen.getByLabelText("Resumo da prévia");
    expect(within(summary).getByText("3 prontos")).toBeInTheDocument();
    expect(within(summary).getByText("2 com erro")).toBeInTheDocument();
    expect(within(summary).getByText("1 possível duplicado")).toBeInTheDocument();
    expect(screen.getByText("E-mail inválido")).toBeInTheDocument();
    expect(screen.getByText("Data de nascimento inválida")).toBeInTheDocument();
    expect(screen.getByText("Mesmo e-mail de um paciente já cadastrado")).toBeInTheDocument();
    expect(screen.getByText("E-mail repetido não entra.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Importar mesmo assim")).toBeNull();
    expect(screen.getByRole("button", { name: "Importar 3 pacientes" })).toBeEnabled();
    expect(screen.getByText(/Não enviamos convite nem e-mail/)).toBeInTheDocument();
  });

  it("confirmar envia só os 3 prontos (sem duplicado nem erro) e mostra o resultado do protótipo", async () => {
    const { onDone } = renderDialog();
    await upload();
    await toPreview();
    await userEvent.click(screen.getByRole("button", { name: "Importar 3 pacientes" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("3 pacientes importados. 1 duplicado ficou de fora. 2 linhas com erro não entraram.");
    expect(api.importPatients).toHaveBeenCalledTimes(1);
    const [clinic, filename, rows] = api.importPatients.mock.calls[0];
    expect(clinic).toBe("c1");
    expect(filename).toBe("pacientes_teste.csv");
    expect(rows.map((r: { name: string }) => r.name)).toEqual(["Marina Teles (QA)", "Bruno Azevedo (QA)", "Clara Nunes (QA)"]);
    expect(rows[0]).toMatchObject({ email: "marina.qa@dizeops.com", birth_date: "1990-05-10", weight_kg: 70.5, force: false });
    expect(rows.every((r: { force: boolean }) => r.force === false)).toBe(true);
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining("3 pacientes importados"));
    expect(screen.getByText(/Importado de pacientes_teste.csv/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Linhas que ficaram de fora" })).toHaveTextContent("Mariana Teste");
  });

  it("duplicado por telefone pode ser liberado ('Importar mesmo assim') e o botão passa a contar", async () => {
    api.getImportDedupeKeys.mockResolvedValue([{ email: null, name: "Outra", birth_date: null, phone_key: "17998123344" }]);
    renderDialog();
    await upload();
    await toPreview();
    // Marina (telefone igual ao de um paciente da clínica) fica de fora; Bruno, Clara e Mariana (sem duplicado aqui) estão prontos
    expect(screen.getByRole("button", { name: "Importar 3 pacientes" })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Importar mesmo assim"));
    expect(screen.getByRole("button", { name: "Importar 4 pacientes" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Importar 4 pacientes" }));
    await screen.findByRole("status");
    const rows = api.importPatients.mock.calls[0][2] as Array<{ name: string; force: boolean }>;
    expect(rows.find((r) => r.name.startsWith("Marina"))?.force).toBe(true);
  });

  it("o servidor ainda pode barrar duplicado: o resultado soma ao que ficou de fora", async () => {
    api.importPatients.mockResolvedValue({
      batch_id: "b", imported: 2, duplicates: 1, errors: 0,
      results: [{ line: 2, status: "importado" }, { line: 3, status: "duplicado", reason: "email" }, { line: 4, status: "importado" }],
    });
    renderDialog();
    await upload();
    await toPreview();
    await userEvent.click(screen.getByRole("button", { name: "Importar 3 pacientes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("2 pacientes importados. 2 duplicados ficaram de fora. 2 linhas com erro não entraram.");
  });

  it("erro do servidor: mensagem em português, nada some, dá para tentar de novo", async () => {
    api.importPatients.mockRejectedValueOnce({ hint: "BILLING_PATIENT_CAPACITY", message: "x" });
    renderDialog();
    await upload();
    await toPreview();
    await userEvent.click(screen.getByRole("button", { name: "Importar 3 pacientes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("limite de pacientes ativos do plano. Nada foi importado.");
    expect(screen.getByRole("button", { name: "Importar 3 pacientes" })).toBeEnabled();
  });

  it("se não der para conferir os duplicados da clínica, não deixa importar", async () => {
    api.getImportDedupeKeys.mockRejectedValue(new Error("rede"));
    renderDialog();
    await upload();
    await userEvent.click(screen.getByRole("button", { name: "Conferir prévia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não é seguro importar agora/);
    expect(screen.getByRole("button", { name: /^Importar \d+ pacientes?$/ })).toBeDisabled();
    expect(api.importPatients).not.toHaveBeenCalled();
  });

  it("arquivo inválido mostra mensagem em português e fica no passo 1", async () => {
    renderDialog();
    const input = screen.getByLabelText(/arquivo de pacientes/i);
    fireEvent.change(input, { target: { files: [csvFile("x", "documento.pdf")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Use um arquivo .csv ou .xlsx.");
    expect(screen.getByText(/Passo 1 de 3/)).toBeInTheDocument();
    await waitFor(() => expect(api.getImportDedupeKeys).not.toHaveBeenCalled());
  });
});
