// Consulta assistida — modelo de seções do prontuário (padrão semeado em clinical_templates).
// Puro (sem Deno/DOM): usado pelas Edge Functions e pela web. O seed da migration
// 20261113120000 deve ser IGUAL a DEFAULT_SECTIONS (há teste que compara os dois).

export interface TemplateField {
  id: string;
  label: string;
}
export interface TemplateSection {
  id: string;
  title: string;
  fields: TemplateField[];
}
export interface TemplateSnapshot {
  name: string;
  version: number;
  sections: TemplateSection[];
}

export const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: "identificacao", title: "Identificação e objetivo", fields: [{ id: "objetivo", label: "Objetivo do paciente" }] },
  {
    id: "queixa",
    title: "Queixa principal e história",
    fields: [
      { id: "queixa_principal", label: "Queixa principal" },
      { id: "historia", label: "História da doença atual" },
    ],
  },
  {
    id: "antecedentes_pessoais",
    title: "Antecedentes pessoais",
    fields: [
      { id: "doencas", label: "Doenças" },
      { id: "cirurgias", label: "Cirurgias" },
    ],
  },
  { id: "medicacoes", title: "Medicações em uso", fields: [{ id: "medicacoes_em_uso", label: "Medicações em uso" }] },
  {
    id: "suplementos_hormonios",
    title: "Suplementos e hormônios",
    fields: [
      { id: "uso_atual", label: "Uso atual" },
      { id: "uso_anterior", label: "Uso anterior" },
    ],
  },
  {
    id: "antecedentes_familiares",
    title: "Antecedentes familiares",
    fields: [{ id: "antecedentes_familiares", label: "Antecedentes familiares" }],
  },
  {
    id: "habitos",
    title: "Hábitos",
    fields: [
      { id: "atividade_fisica", label: "Atividade física" },
      { id: "sono", label: "Sono" },
      { id: "agua", label: "Água" },
      { id: "intestino", label: "Intestino" },
      { id: "alimentacao", label: "Alimentação" },
      { id: "intolerancias", label: "Intolerâncias" },
      { id: "alcool_tabaco", label: "Álcool e tabaco" },
      { id: "estresse", label: "Estresse" },
    ],
  },
  { id: "exames", title: "Exames trazidos", fields: [{ id: "exames_trazidos", label: "Exames trazidos" }] },
  { id: "avaliacao", title: "Avaliação e hipóteses", fields: [{ id: "avaliacao_hipoteses", label: "Avaliação e hipóteses" }] },
  {
    id: "conduta",
    title: "Conduta",
    fields: [
      { id: "exames_solicitados", label: "Exames solicitados" },
      { id: "medicacao_manipulados", label: "Medicação e manipulados" },
      { id: "encaminhamentos", label: "Encaminhamentos (nutricionista, personal)" },
    ],
  },
  {
    id: "combinados",
    title: "Combinados com o paciente",
    fields: [{ id: "combinados", label: "O que cada um vai enviar e até quando" }],
  },
  { id: "retorno", title: "Próximo retorno", fields: [{ id: "proximo_retorno", label: "Próximo retorno" }] },
];

export const AGREEMENTS_KEY = "combinados.combinados";
export const RETURN_KEY = "retorno.proximo_retorno";

export function fieldKey(sectionId: string, fieldId: string): string {
  return `${sectionId}.${fieldId}`;
}

export function listFieldKeys(sections: TemplateSection[]): string[] {
  return sections.flatMap((s) => s.fields.map((f) => fieldKey(s.id, f.id)));
}
