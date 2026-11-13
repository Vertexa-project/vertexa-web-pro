// Consulta assistida — MODO DEMONSTRAÇÃO (sem chave de IA). Roteiro 100% FICTÍCIO de uma consulta de
// emagrecimento (médica e paciente inventadas; nenhum dado real). Determinístico.
import type { AiFields } from "./record.ts";

export const DEMO_BANNER = "Demonstração: transcrição simulada até a chave de IA ser configurada";

export interface DemoSegment {
  speaker: string;
  text: string;
}

export const DEMO_SEGMENTS: DemoSegment[] = [
  { speaker: "Médica", text: "Bom dia, Carla. Me conta o que te traz aqui hoje e qual é o seu objetivo com o acompanhamento." },
  {
    speaker: "Paciente",
    text: "Bom dia, doutora. Quero perder uns doze quilos. Engordei depois da segunda gravidez e nunca voltei ao peso de antes. Tenho trinta e oito anos, sinto muito cansaço e inchaço.",
  },
  { speaker: "Médica", text: "Entendi. Você tem alguma doença, já fez cirurgia, usa algum remédio ou suplemento? E na família, tem alguma doença?" },
  {
    speaker: "Paciente",
    text: "Tenho hipotireoidismo, tomo levotiroxina cinquenta de manhã, em jejum. Fiz duas cesáreas e nenhuma outra cirurgia. Tomo vitamina D e ômega 3. Já usei anticoncepcional, parei há uns dois anos. Minha mãe tem diabetes e meu pai tem pressão alta. Trouxe um exame de uns três meses atrás: o TSH deu 4,8 e a glicemia de jejum 98.",
  },
  { speaker: "Médica", text: "E como está a sua rotina? Sono, água, intestino, alimentação, atividade física, álcool, estresse." },
  {
    speaker: "Paciente",
    text: "Durmo umas cinco horas e acordo cansada. Bebo mais ou menos um litro de água por dia. O intestino é preso, vai a cada dois dias. Caminho duas vezes por semana, não faço musculação. Como muito pão e doce à tarde, e tenho intolerância à lactose. Não fumo, tomo vinho no fim de semana. Trabalho bastante e o estresse é alto.",
  },
  {
    speaker: "Médica",
    text: "Pelo que você me contou, suspeito de resistência à insulina junto com o hipotireoidismo mal controlado. Vou pedir TSH, T4 livre, glicemia, insulina e hemoglobina glicada. Vou encaminhar você para a nutricionista e para o personal. Não vou mexer na sua levotiroxina antes dos exames.",
  },
  {
    speaker: "Médica",
    text: "Então combinado: você me envia os exames até o dia vinte e oito e um diário alimentar de sete dias até sexta-feira. Eu envio o plano da nutricionista e a indicação do personal até terça. Nos vemos de novo em trinta dias.",
  },
];

/** Cada pedaço de áudio devolve 2 trechos do roteiro (pedaço 0 → trechos 0 e 1, ...). */
export const DEMO_SEGMENTS_PER_CHUNK = 2;
export const DEMO_ORD_STRIDE = 1000;

export function demoSegmentsForChunk(seq: number): Array<{ ord: number; start_ms: number; speaker: string; text: string }> {
  const out: Array<{ ord: number; start_ms: number; speaker: string; text: string }> = [];
  for (let i = 0; i < DEMO_SEGMENTS_PER_CHUNK; i++) {
    const seg = DEMO_SEGMENTS[seq * DEMO_SEGMENTS_PER_CHUNK + i];
    if (!seg) break;
    out.push({ ord: seq * DEMO_ORD_STRIDE + i, start_ms: i * 20_000, speaker: seg.speaker, text: seg.text });
  }
  return out;
}

/** ord do trecho `idx` do roteiro. */
export function demoOrd(idx: number): number {
  return Math.floor(idx / DEMO_SEGMENTS_PER_CHUNK) * DEMO_ORD_STRIDE + (idx % DEMO_SEGMENTS_PER_CHUNK);
}

interface DemoField {
  key: string;
  value: string;
  from: number[]; // índices do roteiro
}

const DEMO_FIELDS: DemoField[] = [
  { key: "identificacao.objetivo", value: "Perder cerca de 12 kg (ganho de peso após a segunda gravidez). Paciente de 38 anos.", from: [1] },
  { key: "queixa.queixa_principal", value: "Cansaço e inchaço; dificuldade de voltar ao peso anterior.", from: [1] },
  { key: "queixa.historia", value: "Engordou após a segunda gravidez e não voltou ao peso de antes.", from: [1] },
  { key: "antecedentes_pessoais.doencas", value: "Hipotireoidismo.", from: [3] },
  { key: "antecedentes_pessoais.cirurgias", value: "Duas cesáreas. Nenhuma outra cirurgia.", from: [3] },
  { key: "medicacoes.medicacoes_em_uso", value: "Levotiroxina 50 mcg pela manhã, em jejum.", from: [3] },
  { key: "suplementos_hormonios.uso_atual", value: "Vitamina D e ômega 3.", from: [3] },
  { key: "suplementos_hormonios.uso_anterior", value: "Anticoncepcional, interrompido há cerca de dois anos.", from: [3] },
  { key: "antecedentes_familiares.antecedentes_familiares", value: "Mãe com diabetes; pai com pressão alta.", from: [3] },
  { key: "exames.exames_trazidos", value: "Exame de cerca de três meses atrás: TSH 4,8; glicemia de jejum 98.", from: [3] },
  { key: "habitos.atividade_fisica", value: "Caminha duas vezes por semana; não faz musculação.", from: [5] },
  { key: "habitos.sono", value: "Cerca de 5 horas por noite; acorda cansada.", from: [5] },
  { key: "habitos.agua", value: "Cerca de 1 litro por dia.", from: [5] },
  { key: "habitos.intestino", value: "Intestino preso; evacua a cada dois dias.", from: [5] },
  { key: "habitos.alimentacao", value: "Muito pão e doce à tarde.", from: [5] },
  { key: "habitos.intolerancias", value: "Lactose.", from: [5] },
  { key: "habitos.alcool_tabaco", value: "Não fuma; vinho no fim de semana.", from: [5] },
  { key: "habitos.estresse", value: "Alto, por carga de trabalho.", from: [5] },
  { key: "avaliacao.avaliacao_hipoteses", value: "Suspeita de resistência à insulina associada a hipotireoidismo mal controlado.", from: [6] },
  { key: "conduta.exames_solicitados", value: "TSH, T4 livre, glicemia, insulina e hemoglobina glicada.", from: [6] },
  { key: "conduta.medicacao_manipulados", value: "Manter a levotiroxina sem alteração até os exames.", from: [6] },
  { key: "conduta.encaminhamentos", value: "Nutricionista e personal.", from: [6] },
  {
    key: "combinados.combinados",
    value:
      "Paciente envia os exames até o dia 28 e um diário alimentar de 7 dias até sexta-feira.\nMédica envia o plano da nutricionista e a indicação do personal até terça.",
    from: [7],
  },
  { key: "retorno.proximo_retorno", value: "Em 30 dias.", from: [7] },
];

/**
 * Estruturação simulada: preenche só os campos cujos trechos de origem JÁ chegaram na transcrição
 * (`availableOrds`), como a IA faria com o que foi dito até agora.
 */
export function demoStructure(availableOrds: ReadonlySet<number>): AiFields {
  const out: AiFields = {};
  for (const f of DEMO_FIELDS) {
    const ords = f.from.map(demoOrd);
    if (ords.every((o) => availableOrds.has(o))) out[f.key] = { value: f.value, sources: ords };
  }
  return out;
}

export const DEMO_FIELD_KEYS = DEMO_FIELDS.map((f) => f.key);
