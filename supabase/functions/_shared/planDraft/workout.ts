// Treino — modo demonstração DETERMINÍSTICO. Usa SOMENTE exercícios da exercise_library (nome, grupo e id vêm das linhas
// carregadas do banco), sempre com instrução e intervalo. Restrições detectadas (ombro, joelho, lombar, impacto) trocam
// o exercício por outro do mesmo grupo na biblioteca; sem troca possível, o exercício sai e o aviso conta.
import type { BaseKey, DraftExercise, DraftWorkout, LibraryExercise, PlanFacts, WorkoutDraft } from "./types.ts";
import { BASE_LABEL } from "./patientTypes.ts";
import { TRAIN_LABEL, type Restrictions, type TrainTag } from "./restrictions.ts";

/** Instrução curta de cada exercício (o paciente lê no app). Tempo/minutos aparecem no texto quando reps = segundos/minutos. */
export const INSTRUCTION: Record<string, string> = {
  "quadriceps_agachamento-goblet": "Segure o halter junto ao peito, desça com a coluna reta até as coxas ficarem paralelas ao chão e suba empurrando o chão.",
  "quadriceps_agachamento-frontal": "Barra apoiada na frente dos ombros, cotovelos altos; desça controlando e suba sem tirar os calcanhares do chão.",
  "quadriceps_agachamento-bulgaro": "Pé de trás apoiado no banco; desça o joelho de trás em direção ao chão com o tronco firme e suba pela perna da frente.",
  "quadriceps_agachamento-smith": "Pés um pouco à frente da barra; desça até as coxas ficarem paralelas e suba sem travar o joelho.",
  "quadriceps_agachamento-sumo": "Pés afastados e pontas para fora, halter entre as pernas; desça mantendo o tronco reto e suba apertando o glúteo.",
  "quadriceps_passada-caminhando": "Dê um passo largo, desça até os dois joelhos formarem ângulo reto e alterne as pernas caminhando.",
  "quadriceps_sentar-levantar": "Sente na cadeira e levante sem usar as mãos, devagar; sente de novo controlando a descida.",
  "quadriceps_step-up": "Suba no step com uma perna, empurrando pelo calcanhar; desça controlando e troque de lado a cada série.",
  "gluteo_elevacao-pelvica-barra": "Costas apoiadas no banco, barra sobre o quadril; suba o quadril até o tronco ficar reto e aperte o glúteo no alto.",
  "gluteo_abducao-deitado": "Deitado de lado, suba a perna de cima sem girar o quadril; desça devagar.",
  "posterior_mesa-flexora": "Deitado na mesa, dobre os joelhos puxando o rolo em direção ao glúteo e volte devagar.",
  "posterior_terra-romeno-halteres": "Halteres rente às pernas, joelhos levemente dobrados; leve o quadril para trás até sentir o posterior e suba com a coluna reta.",
  "costas_puxada-neutra": "Puxe a barra neutra até a altura do peito, juntando as escápulas; volte controlando.",
  "costas_remada-baixa-polia": "Sentado, tronco firme, puxe o triângulo em direção ao abdômen juntando as escápulas e volte devagar.",
  "costas_remada-cavalinho": "Tronco inclinado com a coluna reta; puxe a barra até o abdômen e desça controlando.",
  "costas_barra-fixa-assistida": "Use a assistência necessária para completar a série; suba até o queixo passar da barra e desça devagar.",
  "peito_supino-reto-halteres": "Deitado no banco, desça os halteres até a linha do peito e empurre para cima sem bater um no outro.",
  "peito_flexao-inclinada": "Mãos no banco, corpo em linha reta; desça o peito até o banco e empurre de volta.",
  "ombro_desenvolvimento-militar": "Em pé, empurre a barra acima da cabeça sem arquear a lombar e desça até a altura do queixo.",
  "ombro_crucifixo-inverso": "Tronco inclinado, abra os braços com os cotovelos levemente dobrados até a altura dos ombros e volte devagar.",
  "triceps_corda-polia": "Cotovelos colados ao corpo; estenda os braços abrindo a corda no final e volte devagar.",
  "triceps_frances-halter": "Halter atrás da cabeça, cotovelos apontando para cima; estenda os braços sem abrir os cotovelos.",
  "biceps_rosca-alternada": "Cotovelos colados ao corpo; suba um halter de cada vez girando o punho e desça devagar.",
  "biceps_rosca-polia": "Cotovelos fixos ao lado do corpo; flexione até a altura do ombro e desça controlando.",
  "core_prancha-frontal": "Apoie antebraços e pontas dos pés, corpo em linha reta, abdômen firme. Tempo em segundos por série.",
  "core_dead-bug": "Deitado, braços e pernas para cima; estenda braço e perna opostos sem tirar a lombar do chão e alterne.",
  "core_perdigueiro": "Em quatro apoios, estenda braço e perna opostos mantendo o tronco parado e alterne os lados.",
  "core_pallof-press": "De lado para a polia, empurre as mãos à frente e resista à rotação do tronco; volte devagar.",
  "core_abdominal-crunch": "Deitado, joelhos dobrados; suba só os ombros contraindo o abdômen e desça devagar.",
  "cardio_caminhada-esteira": "Ritmo em que dê para conversar (moderado). Tempo em minutos.",
  "cardio_bicicleta": "Pedale em ritmo moderado, em que dê para conversar. Tempo em minutos.",
  "cardio_marcha-estacionaria": "Marche no lugar elevando os joelhos em ritmo constante. Tempo em minutos.",
  "mobilidade_gato-camelo": "Em quatro apoios, arredonde e estenda a coluna devagar, acompanhando a respiração.",
  "mobilidade_flexor-quadril": "Joelho de trás no chão, empurre o quadril à frente até sentir o alongamento e respire fundo.",
};
const GROUP_FALLBACK: Record<string, string> = {
  costas: "Movimento controlado, junte as escápulas e evite balançar o tronco.", peito: "Controle a descida e empurre sem tirar os ombros do banco.",
  ombro: "Ombros longe das orelhas e movimento controlado.", biceps: "Cotovelos fixos ao lado do corpo e descida lenta.", triceps: "Cotovelos fixos e amplitude completa.",
  core: "Abdômen firme e respiração contínua, sem prender o ar.", gluteo: "Aperte o glúteo no final do movimento.", posterior: "Controle a volta e não trave os joelhos.",
  quadriceps: "Joelhos alinhados com os pés e descida controlada.", cardio: "Ritmo moderado, em que dê para conversar. Tempo em minutos.",
  mobilidade: "Movimento lento, sem dor, acompanhando a respiração.", elastico: "Mantenha a tensão do elástico em todo o movimento.",
  abdutores: "Movimento controlado, sem balançar.", equilibrio: "Olhe para um ponto fixo e mantenha o tronco firme.",
};

const AVOID: Record<string, TrainTag[]> = {
  "costas_barra-fixa-assistida": ["ombro"], "costas_barra-fixa-pronada": ["ombro"], "costas_barra-fixa-supinada": ["ombro"], "costas_pulldown-bracos-estendidos": ["ombro"],
  "costas_remada-cavalinho": ["lombar"], "costas_levantamento-terra": ["lombar"], "costas_terra-sumo": ["lombar"], "costas_hiperextensao-45": ["lombar"],
  "peito_supino-reto-halteres": ["ombro"], "peito_flexao-inclinada": ["ombro"],
  "ombro_desenvolvimento-militar": ["ombro"], "ombro_crucifixo-inverso": ["ombro"],
  "triceps_paralelas": ["ombro"], "triceps_mergulho-banco": ["ombro"], "triceps_frances-halter": ["ombro"],
  "core_prancha-toque-ombro": ["ombro"], "core_elevacao-pernas": ["lombar"],
  "posterior_terra-romeno-halteres": ["lombar"],
  "quadriceps_agachamento-bulgaro": ["joelho"], "quadriceps_passada-caminhando": ["joelho"], "quadriceps_step-up": ["joelho"],
  "quadriceps_agachamento-frontal": ["joelho", "lombar"],
  "cardio_burpee": ["impacto", "joelho"], "cardio_polichinelo": ["impacto", "joelho"], "cardio_escalador": ["impacto"],
};

/** Exercícios cuja repetição é tempo: segundos (S) ou minutos (M). */
const TIMED: Record<string, "S" | "M"> = {
  "core_prancha-frontal": "S", "cardio_caminhada-esteira": "M", "cardio_bicicleta": "M", "cardio_marcha-estacionaria": "M",
};

type Row = [id: string, sets: number, reps: number, rest: number];
interface DayDef { letter: string; name: string; primary: string; rows: Row[] }

const R = {
  emagrecimento: [
    { letter: "A", name: "Inferiores e core", primary: "quadriceps", rows: [["quadriceps_agachamento-goblet", 3, 12, 60], ["gluteo_elevacao-pelvica-barra", 3, 12, 60], ["quadriceps_step-up", 3, 10, 60], ["posterior_mesa-flexora", 3, 12, 60], ["core_prancha-frontal", 3, 30, 45]] },
    { letter: "B", name: "Superiores", primary: "costas", rows: [["costas_puxada-neutra", 3, 12, 60], ["peito_supino-reto-halteres", 3, 12, 60], ["costas_remada-baixa-polia", 3, 12, 60], ["ombro_desenvolvimento-militar", 3, 10, 60], ["triceps_corda-polia", 3, 12, 45], ["biceps_rosca-alternada", 3, 12, 45]] },
    { letter: "C", name: "Corpo todo e cardio", primary: "cardio", rows: [["posterior_terra-romeno-halteres", 3, 12, 60], ["peito_flexao-inclinada", 3, 10, 60], ["quadriceps_passada-caminhando", 3, 10, 60], ["core_dead-bug", 3, 10, 45], ["cardio_caminhada-esteira", 1, 20, 60]] },
  ],
  cardiometabolico: [
    { letter: "A", name: "Corpo todo 1", primary: "quadriceps", rows: [["quadriceps_sentar-levantar", 3, 12, 75], ["costas_remada-baixa-polia", 3, 12, 75], ["peito_flexao-inclinada", 3, 10, 75], ["gluteo_elevacao-pelvica-barra", 3, 12, 75], ["core_pallof-press", 3, 10, 60], ["cardio_caminhada-esteira", 1, 20, 60]] },
    { letter: "B", name: "Corpo todo 2", primary: "costas", rows: [["quadriceps_agachamento-goblet", 3, 12, 75], ["costas_puxada-neutra", 3, 12, 75], ["peito_supino-reto-halteres", 3, 10, 75], ["posterior_mesa-flexora", 3, 12, 75], ["core_perdigueiro", 3, 10, 60], ["cardio_bicicleta", 1, 20, 60]] },
    { letter: "C", name: "Aeróbico e mobilidade", primary: "cardio", rows: [["cardio_caminhada-esteira", 1, 30, 60], ["cardio_bicicleta", 1, 15, 60], ["mobilidade_gato-camelo", 2, 10, 45], ["mobilidade_flexor-quadril", 2, 8, 45]] },
  ],
  hipertrofia: [
    { letter: "A", name: "Peito, ombro e tríceps", primary: "peito", rows: [["peito_supino-reto-halteres", 4, 10, 90], ["peito_flexao-inclinada", 3, 12, 75], ["ombro_desenvolvimento-militar", 3, 10, 90], ["ombro_crucifixo-inverso", 3, 12, 60], ["triceps_corda-polia", 3, 12, 60], ["triceps_frances-halter", 3, 12, 60]] },
    { letter: "B", name: "Costas e bíceps", primary: "costas", rows: [["costas_barra-fixa-assistida", 4, 8, 90], ["costas_remada-cavalinho", 4, 10, 90], ["costas_puxada-neutra", 3, 12, 75], ["costas_remada-baixa-polia", 3, 12, 75], ["biceps_rosca-alternada", 3, 10, 60], ["biceps_rosca-polia", 3, 12, 60]] },
    { letter: "C", name: "Pernas e glúteo", primary: "quadriceps", rows: [["quadriceps_agachamento-frontal", 4, 8, 120], ["quadriceps_agachamento-bulgaro", 3, 10, 90], ["posterior_terra-romeno-halteres", 4, 10, 90], ["posterior_mesa-flexora", 3, 12, 75], ["gluteo_elevacao-pelvica-barra", 3, 10, 90], ["core_prancha-frontal", 3, 30, 45]] },
  ],
  recomposicao: [
    { letter: "A", name: "Inferiores", primary: "quadriceps", rows: [["quadriceps_agachamento-goblet", 4, 10, 90], ["posterior_terra-romeno-halteres", 3, 10, 90], ["gluteo_elevacao-pelvica-barra", 4, 10, 90], ["posterior_mesa-flexora", 3, 12, 60], ["core_abdominal-crunch", 3, 15, 45]] },
    { letter: "B", name: "Superiores", primary: "costas", rows: [["peito_supino-reto-halteres", 4, 10, 90], ["costas_puxada-neutra", 4, 10, 90], ["ombro_desenvolvimento-militar", 3, 10, 75], ["costas_remada-baixa-polia", 3, 12, 75], ["triceps_corda-polia", 3, 12, 45], ["biceps_rosca-alternada", 3, 12, 45]] },
    { letter: "C", name: "Corpo todo e condicionamento", primary: "cardio", rows: [["quadriceps_agachamento-sumo", 3, 12, 75], ["peito_flexao-inclinada", 3, 12, 60], ["costas_remada-cavalinho", 3, 10, 75], ["quadriceps_passada-caminhando", 3, 10, 75], ["core_prancha-frontal", 3, 30, 45], ["cardio_bicicleta", 1, 15, 60]] },
  ],
  abaixo_peso: [
    { letter: "A", name: "Corpo todo A", primary: "quadriceps", rows: [["quadriceps_agachamento-frontal", 4, 8, 120], ["peito_supino-reto-halteres", 4, 8, 90], ["costas_remada-cavalinho", 4, 8, 90], ["gluteo_elevacao-pelvica-barra", 3, 10, 90], ["biceps_rosca-alternada", 3, 10, 60]] },
    { letter: "B", name: "Corpo todo B", primary: "costas", rows: [["posterior_terra-romeno-halteres", 4, 8, 120], ["ombro_desenvolvimento-militar", 3, 8, 90], ["costas_puxada-neutra", 4, 8, 90], ["quadriceps_agachamento-bulgaro", 3, 10, 90], ["triceps_frances-halter", 3, 10, 60]] },
    { letter: "C", name: "Corpo todo C", primary: "quadriceps", rows: [["quadriceps_agachamento-sumo", 4, 10, 90], ["peito_flexao-inclinada", 3, 10, 75], ["costas_remada-baixa-polia", 3, 10, 75], ["posterior_mesa-flexora", 3, 10, 75], ["core_prancha-frontal", 3, 30, 45]] },
  ],
  retomada: [
    { letter: "A", name: "Base A", primary: "quadriceps", rows: [["quadriceps_sentar-levantar", 3, 10, 75], ["costas_remada-baixa-polia", 3, 12, 75], ["peito_flexao-inclinada", 3, 8, 75], ["gluteo_elevacao-pelvica-barra", 3, 12, 75], ["core_dead-bug", 3, 8, 45], ["cardio_caminhada-esteira", 1, 15, 60]] },
    { letter: "B", name: "Base B", primary: "costas", rows: [["quadriceps_agachamento-goblet", 3, 10, 75], ["costas_puxada-neutra", 3, 12, 75], ["peito_supino-reto-halteres", 3, 10, 75], ["posterior_mesa-flexora", 3, 12, 75], ["core_perdigueiro", 3, 8, 45], ["cardio_bicicleta", 1, 15, 60]] },
  ],
  manutencao: [
    { letter: "A", name: "Corpo todo A", primary: "quadriceps", rows: [["quadriceps_agachamento-goblet", 3, 10, 75], ["peito_supino-reto-halteres", 3, 10, 75], ["costas_remada-baixa-polia", 3, 10, 75], ["posterior_terra-romeno-halteres", 3, 10, 90], ["ombro_desenvolvimento-militar", 3, 10, 60], ["core_prancha-frontal", 3, 30, 45]] },
    { letter: "B", name: "Corpo todo B", primary: "costas", rows: [["gluteo_elevacao-pelvica-barra", 3, 10, 75], ["costas_puxada-neutra", 3, 10, 75], ["peito_flexao-inclinada", 3, 10, 60], ["quadriceps_passada-caminhando", 3, 10, 75], ["biceps_rosca-alternada", 2, 12, 45], ["triceps_corda-polia", 2, 12, 45], ["cardio_bicicleta", 1, 15, 60]] },
  ],
} satisfies Record<string, DayDef[]>;

const TEMPLATE: Record<BaseKey, DayDef[]> = {
  emagrecimento: R.emagrecimento, cardiometabolico: R.cardiometabolico, pre_diabetico: R.cardiometabolico, hipertrofia: R.hipertrofia,
  recomposicao: R.recomposicao, abaixo_peso: R.abaixo_peso, retomada: R.retomada, manutencao: R.manutencao,
};
export const TEMPLATE_EXERCISE_IDS: string[] = [...new Set(Object.values(R).flat().flatMap((d) => d.rows.map((r) => r[0])))];

const GUIDANCE: Record<BaseKey, string[]> = {
  emagrecimento: ["3 treinos por semana, de 45 a 50 min; caminhada leve nos outros dias ajuda no gasto.", "Comece com carga leve (esforço 6–7 de 10) e suba quando completar todas as séries."],
  hipertrofia: ["3 a 4 treinos por semana (A, B, C); descanse um dia entre treinos do mesmo grupo.", "Aumente a carga quando completar todas as repetições com boa técnica."],
  recomposicao: ["3 treinos por semana; força primeiro, condicionamento no fim do dia C.", "Falso magro: priorize ganhar força nos básicos."],
  cardiometabolico: ["Intensidade moderada: deve dar para conversar durante o exercício.", "Pare e avise a equipe se sentir dor no peito, tontura ou falta de ar.", "Medir a pressão antes do treino nos primeiros dias, se o médico orientar."],
  pre_diabetico: ["Intensidade moderada e constância; caminhar 10 a 15 min depois das refeições ajuda a glicemia.", "Pare e avise a equipe se sentir tontura, tremor ou suor frio."],
  abaixo_peso: ["Poucos exercícios básicos e pesados, com descanso longo; evite cardio intenso.", "Reavalie o peso a cada 2–4 semanas."],
  retomada: ["2 treinos por semana no começo (A e B), com carga bem leve; foque na técnica.", "Depois de 3–4 semanas, o profissional pode passar para 3 treinos."],
  manutencao: ["Treino de base AB/full body, 2 a 3 vezes por semana, para manter o hábito sem exagero.", "Troque os exercícios quando enjoar, mantendo a lista da biblioteca."],
};

export interface WorkoutInput { facts: PlanFacts; base: BaseKey; typeLabel: string; restrictions: Restrictions; library: readonly LibraryExercise[] }

const bmiOf = (f: PlanFacts) => (f.weightKg != null && f.heightCm ? f.weightKg / (f.heightCm / 100) ** 2 : null);

export function buildWorkoutDraft(inp: WorkoutInput): WorkoutDraft {
  const { facts, base, restrictions } = inp;
  const byId = new Map(inp.library.map((e) => [e.id, e]));
  const bmi = bmiOf(facts);
  const avoid = new Set<TrainTag>(restrictions.train);
  if (bmi != null && bmi >= 35) avoid.add("impacto");
  const dropped: string[] = [];
  const swapped: string[] = [];
  const blocked = (id: string) => (AVOID[id] ?? []).some((t) => avoid.has(t));

  const workouts: DraftWorkout[] = TEMPLATE[base].map((day) => {
    const used = new Set<string>();
    const exercises: DraftExercise[] = [];
    let work = 5; // minutos: aquecimento + séries
    for (const [id, sets0, reps, rest0] of day.rows) {
      let ex = byId.get(id);
      let finalId = id;
      if (!ex || blocked(id)) {
        const group = ex?.group_key ?? id.split("_")[0];
        const alt = inp.library.find((e) => e.group_key === group && e.id !== id && !used.has(e.id) && !blocked(e.id)
          && !day.rows.some((r) => r[0] === e.id) && !(TIMED[e.id] && !TIMED[id]) && !(TIMED[id] && TIMED[e.id] !== TIMED[id]));
        if (alt) { swapped.push(`${ex?.name ?? id} → ${alt.name}`); ex = alt; finalId = alt.id; } else { dropped.push(ex?.name ?? id); continue; }
      }
      used.add(finalId);
      const timed = TIMED[finalId];
      const older = facts.ageYears != null && facts.ageYears >= 60;
      const sets = older && !timed ? Math.max(2, sets0 - 1) : sets0;
      const rest = rest0 + (older ? 15 : 0);
      const instr = INSTRUCTION[finalId] ?? GROUP_FALLBACK[ex.group_key] ?? "Movimento controlado, sem dor, respirando de forma contínua.";
      work += timed === "M" ? reps : (sets * (timed === "S" ? reps : 40 + rest)) / 60;
      exercises.push({
        name: ex.name, muscle_groups: [ex.group_key], sets, reps, load_kg: null, rest_seconds: rest,
        notes: timed === "S" ? `${instr} (${reps} segundos por série)` : timed === "M" ? `${instr} (${reps} minutos)` : instr,
      });
    }
    const minutes = Math.round(work);
    return { letter: day.letter, name: day.name, primary_muscle_group: day.primary, estimated_minutes: Math.max(20, minutes), exercises };
  }).filter((w) => w.exercises.length > 0);

  const basis: string[] = [];
  const warnings: string[] = [];
  if (facts.ageYears != null) basis.push(`${facts.ageYears} anos${facts.sex ? `, sexo ${facts.sex === "f" ? "feminino" : "masculino"}` : ""}`);
  if (facts.weightKg != null && facts.heightCm != null) basis.push(`Peso ${facts.weightKg.toLocaleString("pt-BR")} kg, altura ${facts.heightCm.toLocaleString("pt-BR")} cm${bmi != null ? ` (IMC ${bmi.toLocaleString("pt-BR", { maximumFractionDigits: 1 })})` : ""}`);
  if (facts.goal) basis.push(`Objetivo da ficha: ${facts.goal}`);
  if (facts.encounterAt) basis.push(`Prontuário finalizado em ${facts.encounterAt}`);
  if (facts.examTitles.length > 0) basis.push(`${facts.examTitles.length} exame(s) anexado(s) (valores não lidos: confira antes de publicar)`);
  basis.push(`Modelo-base ${BASE_LABEL[base]} · ${workouts.length} treinos da Biblioteca de exercícios`);
  if (avoid.size > 0) basis.push(`Cuidados detectados: ${[...avoid].map((t) => TRAIN_LABEL[t]).join(", ")} (exercícios trocados; confira)`);
  if (swapped.length > 0) basis.push(`Trocas feitas: ${swapped.join("; ")}`);
  if (dropped.length > 0) warnings.push(`Sem substituto na biblioteca para: ${dropped.join(", ")}. Revise o treino.`);
  if (!facts.encounterAt) warnings.push("Sem prontuário/anamnese finalizado: o rascunho usa só a ficha e as observações digitadas.");
  if (facts.ageYears == null) warnings.push("Sem data de nascimento: não ajustei volume por idade.");
  warnings.push("Cargas ficam em branco: defina no editor conforme a avaliação do paciente.");

  return {
    title: `Treino ${workouts.map((w) => w.letter).join("/")} · ${inp.typeLabel}`,
    goal: facts.goal ?? inp.typeLabel,
    workouts, guidance: GUIDANCE[base], basis, warnings,
  };
}
