// Consulta assistida — MODO DEMONSTRAÇÃO (sem chave de IA). Roteiro 100% FICTÍCIO de uma consulta de
// emagrecimento (Dra. e paciente inventadas; nenhum dado real). Consulta de emagrecimento + ganho de massa. Determinístico.
import type { AiFields } from "./record.ts";

export const DEMO_BANNER = "Demonstração: transcrição simulada até a chave de IA ser configurada";

export interface DemoSegment {
  speaker: string;
  text: string;
}

export const DEMO_SEGMENTS: DemoSegment[] = [
  { speaker: "Médica", text: "Bom dia, Carla. Esta é a sua primeira consulta comigo, certo? Me conta quantos anos você tem, com o que trabalha e como é a sua rotina." },
  { speaker: "Paciente", text: "Bom dia, doutora. Tenho 38 anos, sou casada e trabalho como analista financeira, em escritório, sentada o dia inteiro. Vim presencialmente e é a primeira vez que consulto com a senhora." },
  { speaker: "Médica", text: "Qual é a sua queixa principal e o que você quer alcançar com o acompanhamento?" },
  { speaker: "Paciente", text: "Eu me sinto \"inchada e sem energia\". Quero perder uns doze quilos de gordura e, ao mesmo tempo, ganhar massa muscular, porque me sinto flácida. Também queria entender se a minha tireoide está atrapalhando." },
  { speaker: "Médica", text: "Como foi a evolução do seu peso? Você já tentou alguma coisa antes?" },
  { speaker: "Paciente", text: "Engordei uns dez quilos depois da segunda gravidez, há quatro anos, e nunca voltei ao peso de antes. Fiz dieta low carb por três meses, perdi cinco quilos e recuperei tudo. Há dois anos passei por uma nutricionista, mas larguei depois de dois meses. Nunca usei remédio para emagrecer. Eu me restrinjo a semana toda e no fim de semana descontrolo, como muito doce, principalmente quando estou ansiosa." },
  { speaker: "Médica", text: "Você tem alguma doença, já fez cirurgia, já foi internada, tem alguma alergia? Usa remédios, suplementos ou hormônios?" },
  { speaker: "Paciente", text: "Tenho hipotireoidismo desde 2019. Fiz duas cesáreas, em 2017 e em 2022, e nunca fui internada além dos partos. Tenho alergia a dipirona. Tomo levotiroxina 50 microgramas todas as manhãs, em jejum, há cinco anos. Tomo vitamina D e ômega 3. Usei anticoncepcional até dois anos atrás. Nunca usei hormônio nem anabolizante. Na família, minha mãe tem diabetes tipo 2 desde os cinquenta anos, e meu pai teve infarto aos sessenta e dois anos e hoje tem pressão alta." },
  { speaker: "Médica", text: "Me conta dos seus hábitos: exercício, sono, água, intestino, alimentação, álcool, cigarro e estresse." },
  { speaker: "Paciente", text: "Faço caminhada leve duas vezes por semana, uns trinta minutos, e nunca fiz musculação. Durmo cinco horas por noite e acordo cansada. Bebo um litro de água por dia. O intestino funciona a cada dois dias, fica preso. No café da manhã tomo só um café com pão, almoço às treze horas, o lanche da tarde é pão com doce e janto às vinte e uma horas. Tenho intolerância à lactose. Tomo duas taças de vinho no fim de semana e não fumo. O estresse é alto, tenho ansiedade e não faço acompanhamento." },
  { speaker: "Médica", text: "E sintomas? Algo no aparelho digestivo, no coração, na respiração, nas articulações?" },
  { speaker: "Paciente", text: "Tenho inchaço abdominal e refluxo de vez em quando. Não tenho dor no peito nem falta de ar. Sinto dor no joelho direito quando subo escada. Também tenho queda de cabelo e a pele está muito seca." },
  { speaker: "Médica", text: "Vamos às medidas. Peso 78,4 quilos, altura 1,68 metro, IMC 27,8. Circunferência abdominal 91 centímetros. Pressão 128 por 82 e frequência cardíaca 76. Na bioimpedância, 36 por cento de gordura e 47,2 quilos de massa magra. Você trouxe algum exame?" },
  { speaker: "Paciente", text: "Trouxe um exame de março deste ano: TSH 4,8, glicemia de jejum 98, colesterol LDL 142 e vitamina D 24." },
  { speaker: "Médica", text: "Minha impressão é de sobrepeso, com excesso de gordura e pouca massa magra. O hipotireoidismo pode estar subtratado, porque o TSH está acima do ideal. Suspeito de resistência à insulina, pelo histórico familiar, pela gordura abdominal e pela compulsão por doce. Há também um padrão de ansiedade que influencia a sua alimentação." },
  { speaker: "Médica", text: "Na primeira etapa vou pedir TSH, T4 livre, anticorpos antitireoidianos, glicemia, insulina, hemoglobina glicada e perfil lipídico. Não vou mudar a levotiroxina antes dos exames. Vou prescrever creatina três gramas por dia e manter a vitamina D e o ômega 3; a dose da vitamina D eu ajusto quando o exame sair. Oriento aumentar a água para dois litros, colocar proteína em todas as refeições e dormir pelo menos sete horas. Vou encaminhar você para a nutricionista e para o personal, com musculação três vezes por semana, e sugiro acompanhamento psicológico para a ansiedade. Vamos reavaliar a cada trinta dias." },
  { speaker: "Médica", text: "Então combinado: você me envia os exames até o dia vinte e oito de novembro e um diário alimentar de sete dias até sexta-feira. Eu envio o plano da nutricionista e a indicação do personal até terça. Nos vemos em trinta dias; traga os exames, uma foto de corpo inteiro e o seu peso da semana." },
  { speaker: "Paciente", text: "Combinado, doutora. Obrigada." },
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
  { key: "identificacao.idade", value: "38 anos.", from: [1] },
  { key: "identificacao.profissao_rotina", value: "Analista financeira; trabalho de escritório, sentada durante todo o dia.", from: [1] },
  { key: "identificacao.estado_civil", value: "Casada.", from: [1] },
  { key: "identificacao.tipo_atendimento", value: "Presencial.", from: [1] },
  { key: "identificacao.primeira_ou_retorno", value: "Primeira consulta.", from: [0, 1] },
  { key: "objetivo.queixa_principal", value: "\"Inchada e sem energia\".", from: [3] },
  { key: "objetivo.objetivo_principal", value: "Emagrecimento (cerca de 12 kg de gordura) com ganho de massa muscular.", from: [3] },
  { key: "objetivo.objetivos_secundarios", value: "Entender se a tireoide interfere no peso.", from: [3] },
  { key: "historia.evolucao_peso_corpo", value: "Ganho de cerca de 10 kg após a segunda gestação, há 4 anos, sem retorno ao peso anterior.", from: [5] },
  { key: "historia.tentativas_anteriores", value: "Dieta low carb por 3 meses (perdeu 5 kg e recuperou todo o peso). Acompanhamento nutricional há 2 anos, interrompido após 2 meses. Nunca usou medicação para emagrecer.", from: [5] },
  { key: "historia.padrao_alimentar_comportamento", value: "Restrição alimentar durante a semana e descontrole no fim de semana, com consumo elevado de doces, principalmente em episódios de ansiedade.", from: [5] },
  { key: "historia.fatores_desencadeantes", value: "Segunda gestação; ansiedade.", from: [5] },
  { key: "antecedentes_pessoais.doencas", value: "Hipotireoidismo, desde 2019.", from: [7] },
  { key: "antecedentes_pessoais.cirurgias", value: "Duas cesáreas (2017 e 2022).", from: [7] },
  { key: "antecedentes_pessoais.internacoes", value: "Nenhuma, além dos partos.", from: [7] },
  { key: "antecedentes_pessoais.alergias", value: "Dipirona.", from: [7] },
  { key: "medicacoes.uso_atual", value: "Levotiroxina 50 mcg, pela manhã, em jejum, há 5 anos.", from: [7] },
  { key: "medicacoes.uso_anterior", value: "Anticoncepcional, até cerca de 2 anos atrás.", from: [7] },
  { key: "suplementos.uso_atual", value: "Vitamina D e ômega 3.", from: [7] },
  { key: "suplementos.nao_usou", value: "Nega uso de hormônios e de anabolizantes.", from: [7] },
  { key: "antecedentes_familiares.antecedentes_familiares", value: "Mãe: diabetes tipo 2, desde os 50 anos.\nPai: infarto aos 62 anos; hipertensão arterial atual.", from: [7] },
  { key: "habitos.atividade_fisica", value: "Caminhada leve, 2 vezes por semana, cerca de 30 minutos. Nunca fez musculação.", from: [9] },
  { key: "habitos.sono", value: "5 horas por noite; acorda cansada.", from: [9] },
  { key: "habitos.hidratacao", value: "1 litro de água por dia.", from: [9] },
  { key: "habitos.intestino", value: "Constipação; evacua a cada 2 dias.", from: [9] },
  { key: "habitos.alimentacao", value: "Café da manhã: café com pão.\nAlmoço: 13h.\nLanche da tarde: pão com doce.\nJantar: 21h.", from: [9] },
  { key: "habitos.intolerancias", value: "Lactose.", from: [9] },
  { key: "habitos.alcool", value: "2 taças de vinho no fim de semana.", from: [9] },
  { key: "habitos.tabagismo", value: "Não fuma.", from: [9] },
  { key: "habitos.estresse_saude_mental", value: "Estresse alto; ansiedade, sem acompanhamento.", from: [9] },
  { key: "habitos.rotina_trabalho", value: "Trabalho sedentário, em escritório.", from: [1] },
  { key: "revisao_sistemas.gastrointestinal", value: "Inchaço abdominal; refluxo ocasional.", from: [11] },
  { key: "revisao_sistemas.cardiovascular", value: "Nega dor no peito.", from: [11] },
  { key: "revisao_sistemas.respiratorio", value: "Nega falta de ar.", from: [11] },
  { key: "revisao_sistemas.osteoarticular", value: "Dor no joelho direito ao subir escadas.", from: [11] },
  { key: "revisao_sistemas.outros_sintomas", value: "Queda de cabelo; pele muito seca.", from: [11] },
  { key: "exame_fisico.peso", value: "78,4 kg.", from: [12] },
  { key: "exame_fisico.altura", value: "1,68 m.", from: [12] },
  { key: "exame_fisico.imc", value: "27,8 kg/m².", from: [12] },
  { key: "exame_fisico.circunferencia_abdominal", value: "91 cm.", from: [12] },
  { key: "exame_fisico.pressao_arterial", value: "128 x 82 mmHg.", from: [12] },
  { key: "exame_fisico.frequencia_cardiaca", value: "76 bpm.", from: [12] },
  { key: "exame_fisico.composicao_corporal", value: "Bioimpedância: gordura corporal 36%; massa magra 47,2 kg.", from: [12] },
  { key: "exames_trazidos.exames_trazidos", value: "Exame de março deste ano: TSH 4,8; glicemia de jejum 98; LDL 142; vitamina D 24.", from: [13] },
  { key: "avaliacao.impressao_clinica", value: "Sobrepeso, com excesso de gordura e pouca massa magra. Hipotireoidismo possivelmente subtratado (TSH acima do ideal). Padrão de ansiedade que influencia a alimentação.", from: [14] },
  { key: "avaliacao.hipoteses_diagnosticas", value: "Sobrepeso; hipotireoidismo em tratamento; suspeita de resistência à insulina (histórico familiar, gordura abdominal e compulsão por doce).", from: [14] },
  { key: "conduta.exames_solicitados", value: "Primeira etapa: TSH, T4 livre, anticorpos antitireoidianos, glicemia, insulina, hemoglobina glicada e perfil lipídico.", from: [15] },
  { key: "conduta.medicacao_manipulados", value: "Manter levotiroxina 50 mcg, sem alteração antes dos exames.", from: [15] },
  { key: "conduta.suplementacao", value: "Creatina 3 g por dia. Manter vitamina D e ômega 3; dose da vitamina D a ajustar após o exame.", from: [15] },
  { key: "conduta.orientacoes", value: "Aumentar a água para 2 litros por dia.\nIncluir proteína em todas as refeições.\nDormir pelo menos 7 horas por noite.", from: [15] },
  { key: "conduta.encaminhamentos", value: "Nutricionista.\nPersonal (musculação 3 vezes por semana).\nSugerido acompanhamento psicológico para a ansiedade.", from: [15] },
  { key: "conduta.plano_acompanhamento", value: "Reavaliação a cada 30 dias.", from: [15] },
  { key: "combinados.combinados", value: "Paciente envia os exames até 28 de novembro.\nPaciente envia um diário alimentar de 7 dias até sexta-feira.\nMédica envia o plano da nutricionista e a indicação do personal até terça-feira.", from: [16] },
  { key: "retorno.prazo_retorno", value: "Em 30 dias.", from: [16] },
  { key: "retorno.o_que_trazer", value: "Exames, foto de corpo inteiro e o peso da semana.", from: [16] },
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
