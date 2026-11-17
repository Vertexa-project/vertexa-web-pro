// Restrições detectadas no texto do prontuário + observações do profissional. Heurística por palavra-chave:
// o rascunho SEMPRE lista o que detectou para o profissional conferir (nunca é decisão silenciosa).
export type FoodTag = "lactose" | "gluten" | "ovo" | "oleaginosas" | "peixe" | "carne";
export type TrainTag = "ombro" | "joelho" | "lombar" | "impacto";

export interface Restrictions { food: FoodTag[]; train: TrainTag[] }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const FOOD: Array<[FoodTag, RegExp]> = [
  ["lactose", /(lactose|leite de vaca|alergia ao leite|alergia a proteina do leite|\bapls\b)/],
  ["gluten", /(gluten|celiac|doenca celiaca)/],
  ["ovo", /(alergia (a|ao) ovo|intolerancia (a|ao) ovo|nao come ovo|sem ovo)/],
  ["oleaginosas", /(amendoim|castanha|oleaginosa|nozes)/],
  ["peixe", /(alergia (a|ao) (peixe|frutos do mar)|frutos do mar|crustaceo)/],
  ["carne", /(vegetarian|vegan|nao come carne|sem carne)/],
];
const TRAIN: Array<[TrainTag, RegExp]> = [
  ["ombro", /(ombro|manguito|tendinite no ombro|bursite)/],
  ["joelho", /(joelho|menisco|ligamento cruzado|condromalacia|artrose)/],
  ["lombar", /(lombar|hernia de disco|hernia|ciatica|lombalgia|coluna)/],
  ["impacto", /(impacto|obesidade grau|obesidade morbida|sobrepeso importante)/],
];

export function detectRestrictions(...texts: string[]): Restrictions {
  const t = norm(texts.join(" \n "));
  return {
    food: FOOD.filter(([, re]) => re.test(t)).map(([tag]) => tag),
    train: TRAIN.filter(([, re]) => re.test(t)).map(([tag]) => tag),
  };
}

export const FOOD_LABEL: Record<FoodTag, string> = {
  lactose: "lactose/leite", gluten: "glúten", ovo: "ovo", oleaginosas: "amendoim/castanhas", peixe: "peixe/frutos do mar", carne: "sem carne",
};
export const TRAIN_LABEL: Record<TrainTag, string> = { ombro: "ombro", joelho: "joelho", lombar: "lombar/coluna", impacto: "exercícios de impacto" };
