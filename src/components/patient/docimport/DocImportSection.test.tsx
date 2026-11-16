import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { derivePermissions } from "@/lib/domain/disciplines";
import { readDemo } from "../../../../supabase/functions/_shared/docread/demo";
import type { DocKind, DocReadResult } from "../../../../supabase/functions/_shared/docread/types";

const fx = (n: string): string[] => JSON.parse(readFileSync(`${__dirname}/../../../../supabase/functions/_shared/docread/fixtures/${n}.json`, "utf8"));
const FILE: Record<DocKind, string> = { bioimpedancia: "bioimpedancia-mariana-incerta", dieta: "dieta-mariana-teste", treino: "treino-mariana-teste" };

const h = vi.hoisted(() => ({
  disciplines: [] as string[],
  roles: [] as string[],
  isAdmin: false,
  kind: "bioimpedancia" as string,
  photo: false,
  createBodyAssessment: vi.fn(),
  saveNutritionPlan: vi.fn(),
  saveWorkoutPlan: vi.fn(),
  registerPatientDocument: vi.fn(),
  resolveDocRead: vi.fn(),
  removeDocumentObject: vi.fn(),
  uploadPatientDocumentObject: vi.fn(),
  readDocument: vi.fn(),
}));

vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { id: "pro-1", clinicId: "cli-1" }, isLoading: false }) }));
vi.mock("@/hooks/useDisciplines", async () => {
  const { derivePermissions: dp } = await import("@/lib/domain/disciplines");
  return { useDisciplinePermissions: () => ({ perms: dp(h.disciplines), disciplines: h.disciplines, isLoading: false }) };
});
vi.mock("@/hooks/useFin", () => ({
  useFinAccess: () => ({ access: { isAdmin: h.isAdmin, roles: h.roles.map((role) => ({ role, allUnits: true, unitIds: [] })), can: {} }, isLoading: false }),
}));
vi.mock("@/lib/domain/stockMoves", () => ({ todayIsoBR: () => "2026-11-16" }));
vi.mock("@/lib/api/assessments", () => ({ createBodyAssessment: h.createBodyAssessment, assessmentErrorMessage: () => "erro de avaliação" }));
vi.mock("@/lib/api/planMutations", () => ({ saveNutritionPlan: h.saveNutritionPlan, saveWorkoutPlan: h.saveWorkoutPlan }));
vi.mock("@/lib/api/documents", () => ({
  uploadPatientDocumentObject: h.uploadPatientDocumentObject,
  registerPatientDocument: h.registerPatientDocument,
  removeDocumentObject: h.removeDocumentObject,
  getDocumentSignedUrl: async () => "https://signed.example/doc.pdf",
}));
vi.mock("@/lib/api/docRead", () => ({
  readDocument: h.readDocument,
  resolveDocRead: h.resolveDocRead,
  warmDocReader: () => undefined,
  friendlyDocReadError: (c: string) => `erro:${c}`,
}));

import { DocImportSection } from "./DocImportSection";

const patient = { id: "pat-1" } as never;
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const LABEL: Record<DocKind, string> = { bioimpedancia: "Importar bioimpedância (PDF ou foto)", dieta: "Importar dieta de PDF", treino: "Importar treino de PDF" };

beforeEach(() => {
  vi.clearAllMocks();
  h.disciplines = ["educador_fisico"];
  h.roles = [];
  h.isAdmin = false;
  h.photo = false;
  h.uploadPatientDocumentObject.mockResolvedValue("pat-1/111.pdf");
  h.registerPatientDocument.mockResolvedValue({ id: "doc-1" });
  h.resolveDocRead.mockResolvedValue({ ok: true });
  h.createBodyAssessment.mockResolvedValue({});
  h.saveWorkoutPlan.mockResolvedValue(undefined);
  h.saveNutritionPlan.mockResolvedValue(undefined);
  h.readDocument.mockImplementation(async (_p: string, kind: DocKind) => {
    const result: DocReadResult = readDemo({ kind, pages: h.photo ? null : fx(FILE[kind]), isImage: h.photo, patientName: "Mariana Teste", today: "2026-11-16" });
    return { mode: "demo", read_id: "read-1", result };
  });
});

async function pick(kind: DocKind, name = "laudo.pdf", type = "application/pdf") {
  const input = screen.getByTestId(`import-file-${kind}`) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["%PDF-1.4 x"], name, { type })] } });
  await screen.findByTestId("conferencia");
}

describe("DocImportSection — permissões", () => {
  it("Recepção, Financeiro e Estoquista não veem o botão", () => {
    for (const role of ["recepcao", "financeiro", "estoquista"]) {
      h.roles = [role];
      h.disciplines = ["nutricionista", "educador_fisico"];
      const { container, unmount } = wrap(<DocImportSection patient={patient} kind="bioimpedancia" />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
  it("educador físico vê treino liberado; dieta aparece travada com o motivo", () => {
    wrap(
      <>
        <DocImportSection patient={patient} kind="treino" />
        <DocImportSection patient={patient} kind="dieta" />
      </>,
    );
    expect(screen.getByRole("button", { name: LABEL.treino })).not.toHaveAttribute("aria-disabled");
    const dieta = screen.getByRole("button", { name: LABEL.dieta });
    expect(dieta).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Requer a disciplina Nutricionista.")).toBeInTheDocument();
  });
  it("os três botões usam os textos do protótipo", () => {
    h.disciplines = ["nutricionista", "educador_fisico"];
    wrap(
      <>
        <DocImportSection patient={patient} kind="bioimpedancia" />
        <DocImportSection patient={patient} kind="dieta" />
        <DocImportSection patient={patient} kind="treino" />
      </>,
    );
    for (const k of ["bioimpedancia", "dieta", "treino"] as const) expect(screen.getByRole("button", { name: LABEL[k] })).toBeInTheDocument();
  });
});

describe("DocImportSection — Conferência de ponta a ponta (modo demonstração)", () => {
  it("lê, mostra o documento e os campos; incertos em laranja; Confirmar só libera depois de conferir todos", async () => {
    wrap(<DocImportSection patient={patient} kind="bioimpedancia" />);
    await pick("bioimpedancia");
    expect(screen.getByText("Conferência · lido pela Vertexa IA")).toBeInTheDocument();
    expect(screen.getByText("Nada foi salvo ainda")).toBeInTheDocument();
    expect(screen.getAllByText("Modo demonstração").length).toBeGreaterThan(0);
    expect(screen.getByTitle("Documento enviado")).toHaveAttribute("src", "https://signed.example/doc.pdf");
    // nada gravado ao abrir a conferência
    expect(h.createBodyAssessment).not.toHaveBeenCalled();
    expect(h.registerPatientDocument).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: "Confirmar avaliação" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Revise 4 campos em laranja para liberar.")).toBeInTheDocument();
    const peso = screen.getByTestId("field-peso");
    expect(peso).toHaveAttribute("data-uncertain", "true");
    expect(peso.className).toMatch(/border-primary/);
    expect(within(peso).getByText("conferir").className).toMatch(/text-primary-ink/);
    expect(within(screen.getByTestId("field-tmb")).queryByText("conferir")).toBeNull();
    expect(within(screen.getByTestId("field-tmb")).getByText(/Fonte: página 1/)).toBeInTheDocument();

    fireEvent.click(within(peso).getByRole("button", { name: "70,3" }));
    expect(screen.getByTestId("field-peso")).toHaveAttribute("data-uncertain", "false");
    for (const k of ["data", "gordura_pct"]) fireEvent.click(within(screen.getByTestId(`field-${k}`)).getByRole("button", { name: /Conferido/ }));
    expect(confirm).toBeDisabled(); // falta a massa magra
    fireEvent.change(within(screen.getByTestId("field-massa_magra")).getByRole("textbox"), { target: { value: "51,5" } });
    expect(confirm).toBeDisabled(); // editar não confere: precisa tocar em "Conferido"
    fireEvent.click(within(screen.getByTestId("field-massa_magra")).getByRole("button", { name: /Conferido/ }));
    expect(confirm).toBeEnabled();
  });

  it("Confirmar grava pela avaliação existente, anexa o documento e deixa o rastro com o nº de campos corrigidos", async () => {
    wrap(<DocImportSection patient={patient} kind="bioimpedancia" />);
    await pick("bioimpedancia");
    fireEvent.click(within(screen.getByTestId("field-peso")).getByRole("button", { name: "70,3" }));
    for (const k of ["data", "gordura_pct"]) fireEvent.click(within(screen.getByTestId(`field-${k}`)).getByRole("button", { name: /Conferido/ }));
    fireEvent.change(within(screen.getByTestId("field-massa_magra")).getByRole("textbox"), { target: { value: "51,5" } });
    fireEvent.click(within(screen.getByTestId("field-massa_magra")).getByRole("button", { name: /Conferido/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar avaliação" }));

    await waitFor(() => expect(h.resolveDocRead).toHaveBeenCalled());
    expect(h.createBodyAssessment).toHaveBeenCalledTimes(1);
    expect(h.createBodyAssessment).toHaveBeenCalledWith(expect.objectContaining({ patientId: "pat-1", professionalId: "pro-1", method: "bioimpedancia", assessed_at: "2026-11-10", weight: 70.3, body_fat_pct: 26.8 }));
    expect(h.registerPatientDocument).toHaveBeenCalledWith(expect.objectContaining({ patientId: "pat-1", path: "pat-1/111.pdf", uploadedByProfessionalId: "pro-1" }));
    expect(h.resolveDocRead).toHaveBeenCalledWith("read-1", "confirmado", { fieldsCorrected: 1, documentId: "doc-1" });
    expect(await screen.findByText(/Avaliação criada a partir do documento/)).toBeInTheDocument();
    expect(screen.queryByTestId("conferencia")).toBeNull();
  });

  it("Descartar não grava nada (nem avaliação, nem documento) e só deixa o rastro", async () => {
    wrap(<DocImportSection patient={patient} kind="bioimpedancia" />);
    await pick("bioimpedancia");
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(h.resolveDocRead).toHaveBeenCalledWith("read-1", "descartado"));
    expect(h.createBodyAssessment).not.toHaveBeenCalled();
    expect(h.saveNutritionPlan).not.toHaveBeenCalled();
    expect(h.saveWorkoutPlan).not.toHaveBeenCalled();
    expect(h.registerPatientDocument).not.toHaveBeenCalled();
    expect(h.removeDocumentObject).toHaveBeenCalledWith("pat-1/111.pdf");
    expect(await screen.findByText("Importação descartada. Nada foi salvo.")).toBeInTheDocument();
    expect(screen.queryByTestId("conferencia")).toBeNull();
  });

  it("foto sem a Vertexa IA: aviso, campos vazios e Confirmar fechado até preencher e conferir", async () => {
    h.photo = true;
    wrap(<DocImportSection patient={patient} kind="bioimpedancia" />);
    await pick("bioimpedancia", "foto.jpg", "image/jpeg");
    expect(screen.getByText(/A leitura de foto precisa da Vertexa IA ativa/)).toBeInTheDocument();
    expect(screen.getByAltText("Documento enviado")).toBeInTheDocument();
    expect(within(screen.getByTestId("field-peso")).getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirmar avaliação" })).toBeDisabled();
  });

  it("dieta: confirma e salva pelo plano alimentar, com aviso de substituição quando já existe plano", async () => {
    h.disciplines = ["nutricionista"];
    wrap(<DocImportSection patient={patient} kind="dieta" />);
    await pick("dieta", "dieta.pdf");
    expect(screen.getByText("Café da manhã")).toBeInTheDocument();
    expect(screen.getByText("Revise 2 campos em laranja para liberar.")).toBeInTheDocument();
    fireEvent.change(within(screen.getByTestId("field-m0.i2")).getByRole("textbox"), { target: { value: "100 g" } });
    fireEvent.click(within(screen.getByTestId("field-m0.i2")).getByRole("button", { name: /Conferido/ }));
    fireEvent.click(within(screen.getByTestId("field-m1.i3")).getByRole("button", { name: /Conferido/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e salvar plano" }));
    await waitFor(() => expect(h.saveNutritionPlan).toHaveBeenCalledTimes(1));
    const input = h.saveNutritionPlan.mock.calls[0][0];
    expect(input.meals[0].items).toContain("Mamão — 100 g");
    expect(h.saveWorkoutPlan).not.toHaveBeenCalled();
    expect(h.createBodyAssessment).not.toHaveBeenCalled();
    await waitFor(() => expect(h.registerPatientDocument).toHaveBeenCalled());
  });

  it("treino: faixa 8–12 vira escolha; salva pelo plano de treino", async () => {
    wrap(<DocImportSection patient={patient} kind="treino" />);
    await pick("treino", "treino.pdf");
    expect(screen.getByText("Treino A")).toBeInTheDocument();
    const reps = screen.getByTestId("field-d0.e1.reps");
    expect(reps).toHaveAttribute("data-uncertain", "true");
    expect(screen.getByText(/traz 8–12 repetições/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "10" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e salvar treino" }));
    await waitFor(() => expect(h.saveWorkoutPlan).toHaveBeenCalledTimes(1));
    expect(h.saveWorkoutPlan.mock.calls[0][0].workouts[0].exercises[1].reps).toBe(10);
    expect(h.saveNutritionPlan).not.toHaveBeenCalled();
  });

  it("erro da leitura mostra mensagem e não deixa conferência aberta", async () => {
    h.readDocument.mockRejectedValueOnce(new Error("sem_disciplina"));
    wrap(<DocImportSection patient={patient} kind="bioimpedancia" />);
    fireEvent.change(screen.getByTestId("import-file-bioimpedancia"), { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("erro:sem_disciplina")).toBeInTheDocument();
    expect(screen.queryByTestId("conferencia")).toBeNull();
    expect(h.removeDocumentObject).toHaveBeenCalledWith("pat-1/111.pdf");
  });

  it("arquivo de tipo errado é recusado antes de subir", async () => {
    wrap(<DocImportSection patient={patient} kind="bioimpedancia" />);
    fireEvent.change(screen.getByTestId("import-file-bioimpedancia"), { target: { files: [new File(["x"], "a.docx", { type: "application/msword" })] } });
    expect(await screen.findByText(/Formato não suportado/)).toBeInTheDocument();
    expect(h.uploadPatientDocumentObject).not.toHaveBeenCalled();
  });
});

void derivePermissions;
