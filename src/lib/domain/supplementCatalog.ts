// Catálogo INICIAL de suplementos comuns (atalho para o profissional). É só preenchimento: nome, dose sugerida
// e momento viram valores EDITÁVEIS; a conduta é do profissional. Onde a dose varia muito por paciente ou exame,
// o texto é "a definir" em vez de um número. NÃO há catálogo de medicamentos: prescrição é livre e do médico.
export interface CatalogSupplement {
  id: string;
  name: string;
  dose: string;
  moment: string;
}

export const SUPPLEMENT_CATALOG: readonly CatalogSupplement[] = [
  { id: "creatina", name: "Creatina", dose: "3 a 5 g", moment: "Pós-treino" },
  { id: "whey", name: "Whey protein", dose: "20 a 30 g", moment: "Pós-treino" },
  { id: "omega3", name: "Ômega 3", dose: "1 a 2 g", moment: "Almoço" },
  { id: "multivitaminico", name: "Multivitamínico", dose: "1 cápsula", moment: "Café da manhã" },
  { id: "colageno", name: "Colágeno", dose: "10 g", moment: "Manhã" },
  { id: "vitamina-d", name: "Vitamina D", dose: "A definir (conforme exame)", moment: "Manhã" },
  { id: "magnesio", name: "Magnésio", dose: "A definir", moment: "Noite" },
  { id: "ferro", name: "Ferro", dose: "A definir (conforme exame)", moment: "Em jejum" },
  { id: "cafeina", name: "Cafeína", dose: "A definir", moment: "Pré-treino" },
  { id: "bcaa", name: "BCAA", dose: "5 a 10 g", moment: "Pré-treino" },
  { id: "probiotico", name: "Probiótico", dose: "1 cápsula", moment: "Manhã" },
];

export function findCatalogItem(id: string): CatalogSupplement | null {
  return SUPPLEMENT_CATALOG.find((c) => c.id === id) ?? null;
}
