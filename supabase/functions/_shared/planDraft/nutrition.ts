// Dieta — modo demonstração DETERMINÍSTICO: mesma ficha + mesmo tipo = mesmo rascunho.
// Calorias: Mifflin-St Jeor (peso/altura/idade/sexo reais da ficha) × fator de atividade leve × fator do tipo.
// Itens/quantidades vêm de modelos-base por perfil e escalam com as calorias. É RASCUNHO: o profissional revisa.
import type { BaseKey, DraftMeal, NutritionDraft, PlanFacts } from "./types.ts";
import { BASE_LABEL } from "./patientTypes.ts";
import { FOOD_LABEL, type FoodTag, type Restrictions } from "./restrictions.ts";

const ACTIVITY = 1.4;
const BASE_FACTOR: Record<BaseKey, number> = {
  emagrecimento: 0.8, cardiometabolico: 0.85, pre_diabetico: 0.88, retomada: 0.95, recomposicao: 1.0, manutencao: 1.0, hipertrofia: 1.1, abaixo_peso: 1.18,
};
const FALLBACK_KCAL = { f: 1700, m: 2200, x: 1900 };
const FLOOR = { f: 1200, m: 1500, x: 1300 };

export const fmtBR = (n: number, d = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: d });

export interface Energy { bmr: number | null; tdee: number | null; target: number; usedFallback: boolean; ageAssumed: boolean }

export function estimateEnergy(f: PlanFacts, base: BaseKey): Energy {
  const sx = f.sex ?? "x";
  if (f.weightKg == null || f.heightCm == null) {
    const k = FALLBACK_KCAL[sx];
    return { bmr: null, tdee: null, target: Math.round((k * BASE_FACTOR[base]) / 10) * 10, usedFallback: true, ageAssumed: false };
  }
  const ageAssumed = f.ageYears == null;
  const age = f.ageYears ?? 35;
  const offset = sx === "m" ? 5 : sx === "f" ? -161 : -78;
  const bmr = 10 * f.weightKg + 6.25 * f.heightCm - 5 * age + offset;
  const tdee = bmr * ACTIVITY;
  let target = tdee * BASE_FACTOR[base];
  target = Math.max(target, FLOOR[sx]);
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), target: Math.round(target / 10) * 10, usedFallback: false, ageAssumed };
}

// ── quantidades: {g:N} gramas (N na porção de 1800 kcal), {u:N} unidades, {c:N} colheres de sopa
function scaleTokens(text: string, s: number): string {
  return text.replace(/\{([guc]):(\d+(?:\.\d+)?)\}/g, (_m, t: string, n: string) => {
    const v = Number(n) * s;
    if (t === "g") return fmtBR(Math.max(10, Math.round(v / (v < 60 ? 5 : 10)) * (v < 60 ? 5 : 10)), 0);
    return fmtBR(Math.max(1, Math.round(v)), 0);
  });
}

type Tagged = { text: string; tags: FoodTag[]; alt: string | null };
/** "Texto ~tag1,tag2~ alternativa" → item com troca por restrição. */
function parseItem(def: string): Tagged {
  const m = def.match(/^(.*?)\s*~([a-z,]+)~\s*(.*)$/);
  if (!m) return { text: def, tags: [], alt: null };
  return { text: m[1], tags: m[2].split(",") as FoodTag[], alt: m[3] || null };
}
function applyItem(def: string, s: number, food: FoodTag[]): string | null {
  const it = parseItem(def);
  const hit = it.tags.some((t) => food.includes(t));
  if (!hit) return scaleTokens(it.text, s);
  return it.alt ? applyItem(it.alt, s, food) : null; // a alternativa pode ter a própria troca (cadeia)
}

interface MealDef { time: string; name: string; share: number; items: string[]; alt: string[] }
type Profile = "deficit" | "cardio" | "superavit" | "equilibrio";
const PROFILE: Record<BaseKey, Profile> = {
  emagrecimento: "deficit", retomada: "equilibrio", recomposicao: "equilibrio", manutencao: "equilibrio",
  cardiometabolico: "cardio", pre_diabetico: "cardio", hipertrofia: "superavit", abaixo_peso: "superavit",
};

const MEALS: Record<Profile, MealDef[]> = {
  deficit: [
    { time: "07:00", name: "Café da manhã", share: 0.22,
      items: ["Ovos mexidos ({u:2} unidades) ~ovo~ Tofu mexido ({g:100} g)", "Pão integral ({u:1} fatia) ~gluten~ Tapioca ({g:40} g de goma)", "Mamão ({g:100} g)", "Café ou chá sem açúcar"],
      alt: ["Iogurte natural ({g:170} g) ~lactose~ Iogurte sem lactose ({g:170} g)", "Aveia ({c:2} colheres de sopa) ~gluten~ Flocos de arroz ({c:2} colheres de sopa)", "Banana ({u:1} unidade)"] },
    { time: "10:00", name: "Lanche da manhã", share: 0.08,
      items: ["Iogurte natural ({g:150} g) ~lactose~ Iogurte sem lactose ({g:150} g)", "Maçã ({u:1} unidade)"],
      alt: ["Fruta da estação ({u:1} unidade)", "Castanhas ({u:3} unidades) ~oleaginosas~ Pipoca sem óleo ({g:15} g)"] },
    { time: "12:30", name: "Almoço", share: 0.30,
      items: ["Filé de frango grelhado ({g:130} g) ~carne~ Tofu grelhado ({g:150} g)", "Arroz integral ({g:100} g)", "Feijão ({g:80} g)", "Legumes refogados ({g:100} g)", "Salada de folhas à vontade com {c:1} colher de azeite"],
      alt: ["Peixe grelhado ({g:140} g) ~peixe,carne~ Omelete de claras ({u:3} claras) ~ovo~ Tofu grelhado ({g:150} g)", "Batata-doce cozida ({g:150} g)", "Legumes no vapor ({g:120} g)", "Salada de folhas à vontade"] },
    { time: "15:30", name: "Lanche da tarde", share: 0.10,
      items: ["Castanhas ({u:4} unidades) ~oleaginosas~ Pipoca sem óleo ({g:20} g)", "Fruta ({u:1} unidade)"],
      alt: ["Queijo branco ({g:40} g) ~lactose~ Pasta de grão-de-bico ({g:40} g)", "Torradas integrais ({u:2} unidades) ~gluten~ Rap10 de mandioca ({u:1} unidade)"] },
    { time: "19:30", name: "Jantar", share: 0.22,
      items: ["Omelete com legumes ({u:2} ovos) ~ovo~ Tofu refogado com legumes ({g:150} g)", "Batata-doce cozida ({g:120} g)", "Salada de folhas e tomate à vontade"],
      alt: ["Carne magra grelhada ({g:120} g) ~carne~ Lentilha cozida ({g:120} g)", "Purê de abóbora ({g:120} g)", "Brócolis no vapor ({g:100} g)"] },
    { time: "22:00", name: "Ceia", share: 0.08,
      items: ["Chá de camomila", "Iogurte natural ({g:120} g) ~lactose~ Iogurte sem lactose ({g:120} g)"],
      alt: ["Chá de camomila", "Fruta ({u:1} unidade)"] },
  ],
  cardio: [
    { time: "07:00", name: "Café da manhã", share: 0.22,
      items: ["Aveia em flocos ({c:3} colheres de sopa) ~gluten~ Flocos de arroz ({c:3} colheres de sopa)", "Leite desnatado ({g:200} ml) ~lactose~ Bebida vegetal sem açúcar ({g:200} ml)", "Frutas vermelhas ou mamão ({g:100} g)", "Linhaça moída ({c:1} colher de sopa)"],
      alt: ["Pão integral ({u:2} fatias) ~gluten~ Tapioca ({g:50} g de goma)", "Ovo cozido ({u:1} unidade) ~ovo~ Pasta de grão-de-bico ({c:2} colheres de sopa)", "Fruta ({u:1} unidade)"] },
    { time: "10:00", name: "Lanche da manhã", share: 0.08,
      items: ["Fruta com casca ({u:1} unidade)", "Castanhas ({u:3} unidades) ~oleaginosas~ Sementes de abóbora ({c:1} colher de sopa)"],
      alt: ["Iogurte natural sem açúcar ({g:150} g) ~lactose~ Iogurte sem lactose ({g:150} g)"] },
    { time: "12:30", name: "Almoço", share: 0.30,
      items: ["Peixe assado (salmão, sardinha ou tilápia) ({g:130} g) ~peixe,carne~ Frango grelhado ({g:130} g) ~carne~ Tofu grelhado ({g:150} g)", "Arroz integral ({g:90} g)", "Feijão ou lentilha ({g:90} g)", "Legumes variados ({g:120} g)", "Salada de folhas à vontade com {c:1} colher de azeite (pouco sal)"],
      alt: ["Frango grelhado ({g:130} g) ~carne~ Tofu grelhado ({g:150} g)", "Quinoa ou batata-doce ({g:100} g)", "Brócolis e cenoura no vapor ({g:120} g)", "Salada de folhas à vontade"] },
    { time: "15:30", name: "Lanche da tarde", share: 0.10,
      items: ["Iogurte natural sem açúcar ({g:150} g) ~lactose~ Iogurte sem lactose ({g:150} g)", "Aveia ({c:1} colher de sopa) ~gluten~ Linhaça ({c:1} colher de sopa)"],
      alt: ["Fruta ({u:1} unidade)", "Castanhas ({u:3} unidades) ~oleaginosas~ Pipoca sem óleo ({g:15} g)"] },
    { time: "19:30", name: "Jantar", share: 0.22,
      items: ["Omelete de legumes ({u:2} ovos) ~ovo~ Tofu refogado ({g:150} g)", "Abóbora cozida ({g:120} g)", "Salada de folhas à vontade com {c:1} colher de azeite"],
      alt: ["Sopa de legumes com frango desfiado ({g:250} g) ~carne~ Sopa de legumes com grão-de-bico ({g:250} g)"] },
    { time: "22:00", name: "Ceia", share: 0.08,
      items: ["Chá sem açúcar", "Fruta ({u:1} unidade)"],
      alt: ["Iogurte natural ({g:120} g) ~lactose~ Iogurte sem lactose ({g:120} g)"] },
  ],
  superavit: [
    { time: "07:00", name: "Café da manhã", share: 0.22,
      items: ["Ovos mexidos ({u:3} unidades) ~ovo~ Tofu mexido ({g:150} g)", "Pão integral ({u:2} fatias) ~gluten~ Tapioca ({g:60} g de goma)", "Banana ({u:1} unidade)", "Leite ({g:200} ml) ~lactose~ Bebida vegetal ({g:200} ml)"],
      alt: ["Aveia ({c:4} colheres de sopa) ~gluten~ Flocos de arroz ({c:4} colheres de sopa)", "Leite ({g:250} ml) ~lactose~ Bebida vegetal ({g:250} ml)", "Banana ({u:1} unidade) com mel ({c:1} colher de sopa)"] },
    { time: "10:00", name: "Lanche da manhã", share: 0.10,
      items: ["Iogurte natural ({g:170} g) ~lactose~ Iogurte sem lactose ({g:170} g)", "Granola ({c:2} colheres de sopa) ~gluten~ Mix de sementes ({c:2} colheres de sopa)", "Fruta ({u:1} unidade)"],
      alt: ["Sanduíche de pão integral ({u:2} fatias) com queijo branco ({g:40} g) ~gluten,lactose~ Tapioca ({g:60} g de goma) com pasta de grão-de-bico ({g:40} g)"] },
    { time: "12:30", name: "Almoço", share: 0.28,
      items: ["Carne magra ou frango grelhado ({g:150} g) ~carne~ Tofu grelhado ({g:180} g)", "Arroz ({g:150} g)", "Feijão ({g:100} g)", "Legumes refogados ({g:100} g)", "Salada à vontade com {c:1} colher de azeite"],
      alt: ["Peixe assado ({g:150} g) ~peixe,carne~ Ovos cozidos ({u:3} unidades) ~ovo~ Tofu grelhado ({g:180} g)", "Macarrão integral ({g:140} g) ~gluten~ Arroz ({g:150} g)", "Legumes refogados ({g:100} g)"] },
    { time: "15:30", name: "Lanche da tarde", share: 0.12,
      items: ["Sanduíche de pão integral ({u:2} fatias) ~gluten~ Tapioca ({g:60} g de goma)", "Frango desfiado ({g:60} g) ~carne~ Pasta de grão-de-bico ({g:60} g)", "Fruta ({u:1} unidade)"],
      alt: ["Pasta de amendoim ({c:1} colher de sopa) ~oleaginosas~ Pasta de sementes ({c:1} colher de sopa)", "Pão integral ({u:2} fatias) ~gluten~ Tapioca ({g:60} g de goma)", "Banana ({u:1} unidade)"] },
    { time: "19:30", name: "Jantar", share: 0.20,
      items: ["Filé de peixe ou frango ({g:140} g) ~carne~ Tofu grelhado ({g:170} g)", "Batata ou mandioca cozida ({g:180} g)", "Legumes no vapor ({g:120} g)", "Salada de folhas à vontade"],
      alt: ["Omelete de {u:3} ovos com legumes ~ovo~ Tofu refogado com legumes ({g:170} g)", "Arroz ({g:130} g)", "Salada à vontade"] },
    { time: "22:00", name: "Ceia", share: 0.08,
      items: ["Iogurte natural ({g:170} g) ~lactose~ Iogurte sem lactose ({g:170} g)", "Aveia ({c:1} colher de sopa) ~gluten~ Mix de sementes ({c:1} colher de sopa)"],
      alt: ["Leite morno ({g:200} ml) ~lactose~ Bebida vegetal ({g:200} ml)", "Fruta ({u:1} unidade)"] },
  ],
  equilibrio: [
    { time: "07:00", name: "Café da manhã", share: 0.22,
      items: ["Ovos ({u:2} unidades) ~ovo~ Tofu mexido ({g:100} g)", "Pão integral ({u:2} fatias) ~gluten~ Tapioca ({g:50} g de goma)", "Fruta ({u:1} unidade)", "Café ou chá sem açúcar"],
      alt: ["Iogurte natural ({g:170} g) ~lactose~ Iogurte sem lactose ({g:170} g)", "Aveia ({c:3} colheres de sopa) ~gluten~ Flocos de arroz ({c:3} colheres de sopa)", "Fruta ({u:1} unidade)"] },
    { time: "10:00", name: "Lanche da manhã", share: 0.08,
      items: ["Fruta ({u:1} unidade)", "Castanhas ({u:3} unidades) ~oleaginosas~ Pipoca sem óleo ({g:15} g)"],
      alt: ["Iogurte natural ({g:150} g) ~lactose~ Iogurte sem lactose ({g:150} g)"] },
    { time: "12:30", name: "Almoço", share: 0.30,
      items: ["Frango, carne magra ou peixe grelhado ({g:140} g) ~carne~ Tofu grelhado ({g:160} g)", "Arroz ({g:120} g)", "Feijão ({g:90} g)", "Legumes ({g:100} g)", "Salada à vontade com {c:1} colher de azeite"],
      alt: ["Ovos cozidos ({u:3} unidades) ~ovo~ Tofu grelhado ({g:160} g)", "Batata-doce ({g:150} g)", "Legumes no vapor ({g:120} g)"] },
    { time: "15:30", name: "Lanche da tarde", share: 0.10,
      items: ["Iogurte natural ({g:150} g) ~lactose~ Iogurte sem lactose ({g:150} g)", "Aveia ({c:1} colher de sopa) ~gluten~ Mix de sementes ({c:1} colher de sopa)", "Fruta ({u:1} unidade)"],
      alt: ["Pão integral ({u:1} fatia) com queijo branco ({g:30} g) ~gluten,lactose~ Tapioca ({g:40} g de goma) com pasta de grão-de-bico ({g:30} g)"] },
    { time: "19:30", name: "Jantar", share: 0.22,
      items: ["Proteína magra grelhada ({g:130} g) ~carne~ Tofu grelhado ({g:150} g)", "Batata-doce ou arroz ({g:120} g)", "Legumes ({g:120} g)", "Salada de folhas à vontade"],
      alt: ["Omelete de {u:2} ovos com legumes ~ovo~ Tofu refogado com legumes ({g:150} g)", "Salada à vontade", "Fruta ({u:1} unidade)"] },
    { time: "22:00", name: "Ceia", share: 0.08,
      items: ["Chá sem açúcar", "Iogurte natural ({g:120} g) ~lactose~ Iogurte sem lactose ({g:120} g)"],
      alt: ["Chá sem açúcar", "Fruta ({u:1} unidade)"] },
  ],
};

const GUIDANCE: Record<BaseKey, string[]> = {
  emagrecimento: [
    "Déficit moderado: não passe fome; priorize proteína e fibras nas refeições principais.",
    "Para vontade de doce: combine uma porção planejada (ex.: 2 quadrados de chocolate 70%) em vez de cortar totalmente (estratégia citada na reunião de 28/10).",
    "Se houver uso de medicação para emagrecimento, ajuste o volume das porções à saciedade do paciente.",
  ],
  hipertrofia: ["Superávit leve: aumente porções de carboidrato nos dias de treino.", "Proteína distribuída em todas as refeições; revise a meta com o peso real."],
  recomposicao: ["Calorias de manutenção com proteína alta (falso magro): o foco é trocar gordura por massa magra, não perder peso.", "Alinhe o horário das refeições com o treino."],
  cardiometabolico: [
    "Plano cardiometabólico: pouco sódio, mais fibras, peixe 2–3 vezes por semana e gorduras boas (azeite, oleaginosas).",
    "Evite ultraprocessados, embutidos e frituras; reveja com os exames de colesterol, glicemia e pressão.",
  ],
  pre_diabetico: [
    "Prefira carboidrato complexo (aveia, arroz integral, leguminosas, batata-doce) e mais fibras em todas as refeições.",
    "Evite açúcar e farinha branca soltos; combine carboidrato com proteína ou gordura boa.",
  ],
  abaixo_peso: ["Superávit com alimentos densos; faça 6 refeições sem pular nenhuma.", "Reavalie o peso a cada 2–4 semanas e ajuste as porções."],
  retomada: ["Retomada gradual: dieta de normalização, simples de seguir (sem restrição severa).", "Adicione mais porções só depois que o paciente estiver seguindo o plano por 2 semanas."],
  manutencao: ["Plano seguível, sem grande déficit; a ideia é consolidar o hábito que o paciente já tem.", "Ajuste quando o paciente trouxer objetivo novo."],
};

export interface NutritionInput { facts: PlanFacts; base: BaseKey; typeLabel: string; restrictions: Restrictions; method?: string | null }

export function buildNutritionDraft(inp: NutritionInput): NutritionDraft {
  const { facts, base, restrictions } = inp;
  const energy = estimateEnergy(facts, base);
  const s = Math.min(1.8, Math.max(0.7, energy.target / 1800));
  const defs = MEALS[PROFILE[base]];
  const food = restrictions.food;

  const rawKcal = defs.map((d) => Math.round((energy.target * d.share) / 5) * 5);
  const diff = energy.target - rawKcal.reduce((a, b) => a + b, 0);
  rawKcal[2] += diff; // ajuste no almoço para a soma bater com a meta

  const meals: DraftMeal[] = defs.map((d, i) => {
    const items = d.items.map((x) => applyItem(x, s, food)).filter((x): x is string => x !== null);
    const altItems = d.alt.map((x) => applyItem(x, s, food)).filter((x): x is string => x !== null);
    const kcal = rawKcal[i];
    return {
      time: d.time, name: d.name, items, calories: kcal,
      options: altItems.length > 0 && d.share >= 0.1 ? [{ items: altItems, calories: kcal }] : [],
    };
  });

  const total = meals.reduce((a, m) => a + m.calories, 0);
  const basis: string[] = [];
  const warnings: string[] = [];
  const sexTxt = facts.sex === "f" ? "feminino" : facts.sex === "m" ? "masculino" : null;
  if (facts.weightKg != null) basis.push(`Peso ${fmtBR(facts.weightKg)} kg (${facts.weightSource ?? "ficha"})`);
  if (facts.heightCm != null) basis.push(`Altura ${fmtBR(facts.heightCm, 0)} cm`);
  if (facts.ageYears != null) basis.push(`${facts.ageYears} anos${sexTxt ? `, sexo ${sexTxt}` : ""}`);
  if (facts.bodyFatPct != null) basis.push(`Gordura corporal ${fmtBR(facts.bodyFatPct)}% (última avaliação)`);
  if (facts.goal) basis.push(`Objetivo da ficha: ${facts.goal}`);
  if (facts.encounterAt) basis.push(`Prontuário finalizado em ${facts.encounterAt}`);
  if (facts.examTitles.length > 0) basis.push(`${facts.examTitles.length} exame(s) anexado(s): ${facts.examTitles.slice(0, 3).join(", ")}${facts.examTitles.length > 3 ? "…" : ""} (valores dos exames não foram lidos: confira antes de publicar)`);
  if (energy.bmr != null && energy.tdee != null) {
    basis.push(`Gasto estimado ${fmtBR(energy.tdee, 0)} kcal/dia (metabolismo basal ${fmtBR(energy.bmr, 0)} × 1,4) → meta ${fmtBR(energy.target, 0)} kcal/dia (${BASE_LABEL[base]})`);
  } else {
    basis.push(`Meta de ${fmtBR(energy.target, 0)} kcal/dia pelo modelo-base ${BASE_LABEL[base]}`);
  }
  if (food.length > 0) basis.push(`Restrições detectadas no prontuário/observações: ${food.map((t) => FOOD_LABEL[t]).join(", ")} (itens trocados; confira)`);

  if (facts.weightKg == null) warnings.push("Sem peso na ficha: usei uma meta de referência. Registre a antropometria e gere de novo para calcular pelas medidas reais.");
  if (facts.weightKg != null && facts.heightCm == null) warnings.push("Sem altura na ficha: usei uma meta de referência em vez do cálculo pelo peso.");
  if (energy.ageAssumed) warnings.push("Sem data de nascimento: assumi 35 anos no cálculo.");
  if (facts.sex == null && !energy.usedFallback) warnings.push("Sexo não informado: usei a média das duas fórmulas.");
  if (!facts.encounterAt) warnings.push("Sem prontuário/anamnese finalizado: o rascunho usa só a ficha e as observações digitadas.");

  const guidance = [...GUIDANCE[base]];
  if (facts.weightKg != null) guidance.push(`Água: cerca de ${fmtBR((facts.weightKg * 35) / 1000, 1)} L por dia (35 ml por kg).`);
  if (inp.method) guidance.push("Método da clínica aplicado ao pedido (Configurações).");

  return { title: `Plano alimentar ${fmtBR(total, 0)} kcal · ${inp.typeLabel}`, meals, totalKcal: total, guidance, basis, warnings };
}
