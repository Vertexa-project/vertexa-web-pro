// Consulta assistida — modelo de seções do prontuário (padrão semeado em clinical_templates).
// Puro (sem Deno/DOM): usado pelas Edge Functions e pela web. O seed da migration
// 20261113130000 (modelo v2) deve ser IGUAL a DEFAULT_SECTIONS (há teste que compara os dois).

export interface TemplateField {
  id: string;
  label: string;
}
export interface TemplateSection {
  id: string;
  title: string;
  /** Seção preenchida pelo SISTEMA (não pela IA nem à mão): não tem campo editável no registro. */
  system?: boolean;
  fields: TemplateField[];
}
export interface TemplateSnapshot {
  name: string;
  version: number;
  sections: TemplateSection[];
}

export const DEFAULT_SECTIONS: TemplateSection[] = [
  {
    id: "identificacao",
    title: "Identificação e contexto",
    fields: [
      { id: "idade", label: "Idade" },
      { id: "profissao_rotina", label: "Profissão e rotina de trabalho" },
      { id: "estado_civil", label: "Estado civil" },
      { id: "tipo_atendimento", label: "Tipo de atendimento (presencial/online)" },
      { id: "primeira_ou_retorno", label: "Primeira consulta ou retorno" },
    ],
  },
  {
    id: "objetivo",
    title: "Motivo da consulta e objetivo",
    fields: [
      { id: "queixa_principal", label: "Queixa principal (frase do paciente)" },
      { id: "objetivo_principal", label: "Objetivo principal" },
      { id: "objetivos_secundarios", label: "Objetivos secundários" },
    ],
  },
  {
    id: "historia",
    title: "História do objetivo atual",
    fields: [
      { id: "evolucao_peso_corpo", label: "Evolução do peso e do corpo" },
      { id: "tentativas_anteriores", label: "Tentativas anteriores (dietas, profissionais, medicações)" },
      { id: "padrao_alimentar_comportamento", label: "Padrão alimentar e comportamento" },
      { id: "fatores_desencadeantes", label: "Fatores desencadeantes" },
    ],
  },
  {
    id: "antecedentes_pessoais",
    title: "Antecedentes pessoais",
    fields: [
      { id: "doencas", label: "Doenças (atuais e prévias)" },
      { id: "cirurgias", label: "Cirurgias" },
      { id: "internacoes", label: "Internações" },
      { id: "alergias", label: "Alergias" },
    ],
  },
  {
    id: "medicacoes",
    title: "Medicações em uso",
    fields: [
      { id: "uso_atual", label: "Uso atual (nome, dose, frequência, desde quando)" },
      { id: "uso_anterior", label: "Uso anterior" },
    ],
  },
  {
    id: "suplementos",
    title: "Suplementos, manipulados e hormônios",
    fields: [
      { id: "uso_atual", label: "Uso atual" },
      { id: "uso_anterior", label: "Uso anterior" },
      { id: "nao_usou", label: "Citados como não utilizados" },
    ],
  },
  {
    id: "antecedentes_familiares",
    title: "Antecedentes familiares",
    fields: [
      { id: "antecedentes_familiares", label: "Doença, parentesco, idade de início e desfecho" },
    ],
  },
  {
    id: "habitos",
    title: "Hábitos de vida",
    fields: [
      { id: "atividade_fisica", label: "Atividade física" },
      { id: "sono", label: "Sono" },
      { id: "hidratacao", label: "Hidratação" },
      { id: "intestino", label: "Intestino" },
      { id: "alimentacao", label: "Alimentação (refeições e horários)" },
      { id: "intolerancias", label: "Intolerâncias" },
      { id: "alcool", label: "Álcool" },
      { id: "tabagismo", label: "Tabagismo" },
      { id: "estresse_saude_mental", label: "Estresse e saúde mental" },
      { id: "rotina_trabalho", label: "Rotina de trabalho" },
    ],
  },
  {
    id: "revisao_sistemas",
    title: "Revisão de sistemas",
    fields: [
      { id: "gastrointestinal", label: "Gastrointestinal" },
      { id: "cardiovascular", label: "Cardiovascular" },
      { id: "respiratorio", label: "Respiratório" },
      { id: "osteoarticular", label: "Osteoarticular e mobilidade" },
      { id: "outros_sintomas", label: "Outros sintomas relevantes" },
    ],
  },
  {
    id: "exame_fisico",
    title: "Exame físico e medidas",
    fields: [
      { id: "peso", label: "Peso" },
      { id: "altura", label: "Altura" },
      { id: "imc", label: "IMC" },
      { id: "circunferencia_abdominal", label: "Circunferência abdominal" },
      { id: "pressao_arterial", label: "Pressão arterial" },
      { id: "frequencia_cardiaca", label: "Frequência cardíaca" },
      { id: "composicao_corporal", label: "Composição corporal (bioimpedância/DEXA)" },
    ],
  },
  {
    id: "exames_trazidos",
    title: "Exames trazidos",
    fields: [
      { id: "exames_trazidos", label: "Exame, data e resultado relevante" },
    ],
  },
  {
    id: "avaliacao",
    title: "Avaliação e hipóteses",
    fields: [
      { id: "impressao_clinica", label: "Impressão clínica" },
      { id: "hipoteses_diagnosticas", label: "Hipóteses diagnósticas" },
    ],
  },
  {
    id: "conduta",
    title: "Conduta",
    fields: [
      { id: "exames_solicitados", label: "Exames solicitados" },
      { id: "medicacao_manipulados", label: "Medicação e manipulados prescritos" },
      { id: "suplementacao", label: "Suplementação" },
      { id: "orientacoes", label: "Orientações dadas" },
      { id: "encaminhamentos", label: "Encaminhamentos (nutricionista, personal, outros)" },
      { id: "plano_acompanhamento", label: "Plano de acompanhamento" },
    ],
  },
  {
    id: "combinados",
    title: "Combinados com o paciente",
    fields: [
      { id: "combinados", label: "Quem faz, o quê e até quando" },
    ],
  },
  {
    id: "retorno",
    title: "Próximo retorno",
    fields: [
      { id: "prazo_retorno", label: "Data ou prazo" },
      { id: "o_que_trazer", label: "O que trazer" },
    ],
  },
  {
    id: "profissional",
    title: "Profissional",
    system: true,
    fields: [
      { id: "nome", label: "Nome" },
      { id: "conselho_numero", label: "Conselho e número" },
      { id: "data_hora", label: "Data e hora do atendimento" },
    ],
  },
];

export const AGREEMENTS_KEY = "combinados.combinados";
export const RETURN_KEY = "retorno.prazo_retorno";

export function fieldKey(sectionId: string, fieldId: string): string {
  return `${sectionId}.${fieldId}`;
}

/** Chaves dos campos editáveis/preenchíveis pela IA (seções de sistema ficam de fora). */
export function listFieldKeys(sections: TemplateSection[]): string[] {
  return sections.filter((s) => !s.system).flatMap((s) => s.fields.map((f) => fieldKey(s.id, f.id)));
}
