import type { Intent } from "./types.ts";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Intenção do pedido. Ordem importa: o que a IA NÃO faz (pagar, diagnosticar) vem antes. */
export function detectIntent(message: string): Intent {
  const n = norm(message);
  if (/marc\w* .*pag|pagou|deu baixa|baixa.*(pagamento|titulo)|movimenta\w* caixa|lanca\w* (pagamento|venda)/.test(n)) return "pagamento";
  if (/diagnost|prescrev|prescri|receit\w* (um|uma|de)|qual (remedio|medicamento)|dose de|doenca (do|da)/.test(n)) return "diagnostico";
  if (/financ|faturamento|receita do mes|atras\w* (de )?pagament|inadimpl|mensalidade|quanto (recebi|faturei)|cobranc|\\bmes\\b/.test(n)) return "financeiro";
  if (/monta\w* .*(treino|dieta)|criar? .*(treino|dieta)|gera\w* .*(treino|dieta)|plano alimentar/.test(n)) return "treino";
  if (/sem registr|parad[oa]|sumid|nao registr/.test(n)) return "sem_registrar";
  if (/quem (eu )?(devo )?(ligar|chamar|precisa)|quem devo|meu dia|prioridade|foco|ligar hoje|preparar meu dia/.test(n)) return "quem_hoje";
  if (/agenda|compromisso|consultas? de hoje|marcad[oa]s? hoje|remarc/.test(n)) return "agenda_hoje";
  if (/retorno|resum|prepar/.test(n)) return "resumo_retorno";
  if (/mensagem|lembrete|rascunh|escrev|respond|avis/.test(n)) return "rascunho_mensagem";
  return "ajuda";
}
