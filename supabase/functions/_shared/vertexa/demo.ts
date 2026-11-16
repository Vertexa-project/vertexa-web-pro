// Modo demonstração: respostas DETERMINÍSTICAS montadas só com fatos reais já lidos (sem OPENAI_API_KEY).
import { actionFor } from "./context.ts";
import type { AiReply, Draft, Fact, Intent, ReplyItem, ScreenContext } from "./types.ts";

const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "paciente";
const byPrefix = (facts: Fact[], p: string) => facts.filter((f) => f.key.startsWith(p));
const get = (facts: Fact[], k: string) => facts.find((f) => f.key === k);
const reply = (r: Partial<AiReply> & { text: string }): AiReply => ({ items: [], draft: null, actions: [], blocked: null, ...r });

export interface DemoInput {
  intent: Intent;
  screen: ScreenContext;
  /** Fatos do dia (agenda sempre; clínicos só com acesso). */
  facts: Fact[];
  /** Fatos do paciente em foco, quando houver E o acesso foi liberado. */
  patientFacts: Fact[] | null;
  /** Paciente pedido mas bloqueado pelo acesso. */
  patientDenied: boolean;
  clinical: boolean;
}

/** Texto do rascunho de mensagem, pelo motivo de atenção. Sem número e sem conselho clínico. */
export function messageFor(name: string, reason: Fact["reason"]): string {
  const n = first(name);
  if (reason === "never_registered") return `Oi, ${n}! Tudo bem? Vi que você ainda não registrou nada no app. Posso te ajudar a começar? É só me chamar por aqui.`;
  if (reason === "adherence_drop") return `Oi, ${n}! Notei que a semana foi mais corrida. Quer me contar como está sendo e combinar o que ajuda para retomar? Estou por aqui.`;
  return `Oi, ${n}! Faz alguns dias que você não registra nada no app. Que tal retomar hoje com um registro rápido? Qualquer dificuldade, fale com a gente.`;
}

export function buildDemoReply(i: DemoInput): AiReply {
  const { intent, facts, patientFacts } = i;
  const needsClinical = ["quem_hoje", "sem_registrar", "resumo_retorno", "rascunho_mensagem"].includes(intent);

  if (intent === "pagamento") {
    return reply({
      text: "Marcar pagamento é com você. Vertexa IA não marca pagamento nem movimenta caixa. O registro fica no seu nome, no Financeiro.",
      actions: [{ label: "Abrir Financeiro", to: "/financeiro" }],
      blocked: "fora_do_escopo",
    });
  }
  if (intent === "diagnostico") {
    return reply({
      text: "Não diagnostico nem prescrevo. Posso organizar o que já está registrado do paciente para você decidir.",
      blocked: "fora_do_escopo",
    });
  }
  if (intent === "financeiro") {
    return reply({
      text: "Nesta versão eu não leio valores do Financeiro. Os números ficam em Gestão, calculados pelo sistema. Posso rascunhar lembretes de cobrança quando você abrir a lista.",
      actions: [{ label: "Abrir Gestão", to: "/gestao" }],
      blocked: "fora_do_escopo",
    });
  }
  if (intent === "treino") {
    return reply({
      text: "Criar treino ou dieta do zero por conversa entra na Etapa 2. Por enquanto eu organizo o que já está registrado, sempre como rascunho.",
      blocked: "fora_do_escopo",
    });
  }
  if (needsClinical && !i.clinical) {
    return reply({
      text: "O seu papel não abre dados clínicos de pacientes, então não consigo falar disso. Posso falar da agenda de hoje.",
      blocked: "sem_acesso",
      actions: [{ label: "Abrir Agenda", to: "/agenda" }],
    });
  }

  if (intent === "agenda_hoje") {
    const ap = byPrefix(facts, "agenda:");
    return reply({
      text: ap.length ? `Você tem ${ap.length} ${ap.length === 1 ? "compromisso" : "compromissos"} hoje.` : "Nenhum compromisso na agenda de hoje.",
      items: ap.map((f) => ({ text: `${f.label} · ${f.value}`, source: f.source })),
      actions: [{ label: "Ver semana", to: "/agenda" }],
    });
  }

  if (intent === "quem_hoje") {
    const foco = byPrefix(facts, "foco:");
    const total = get(facts, "foco_total")?.value ?? foco.length;
    if (!foco.length) return reply({ text: "Ninguém no Foco do dia agora. Nenhum paciente com queda de adesão ou sem registro.", items: [] });
    const items: ReplyItem[] = foco.map((f) => ({ text: `${f.label}: ${f.value}`, source: f.source }));
    const draft: Draft = {
      kind: "lista_ligacoes",
      title: "Quem ligar hoje",
      patientId: null,
      patientName: null,
      body: foco.map((f) => `${f.label} — ${actionFor(f.patientId ?? "", f.reason).label}`).join("\n"),
      fields: foco.map((f) => ({ label: f.label, value: `${f.value} → ${actionFor(f.patientId ?? "", f.reason).label}`, source: f.source })),
    };
    return reply({
      text: `${total} ${total === 1 ? "paciente pede" : "pacientes pedem"} atenção hoje${foco.length < Number(total) ? `; separei os ${foco.length} primeiros` : ""}.`,
      items,
      draft,
      actions: foco.slice(0, 3).map((f) => {
        const a = actionFor(f.patientId ?? "", f.reason);
        return { label: `${a.label} · ${first(f.label)}`, to: a.to };
      }),
    });
  }

  if (intent === "sem_registrar") {
    const l = byPrefix(facts, "semreg:");
    if (!l.length) return reply({ text: "Ninguém está há mais de uma semana sem registrar." });
    return reply({
      text: `${l.length} ${l.length === 1 ? "paciente está" : "pacientes estão"} há mais de uma semana sem registrar.`,
      items: l.slice(0, 8).map((f) => ({ text: `${f.label}: ${f.value}`, source: f.source })),
      actions: l.slice(0, 3).map((f) => {
        const a = actionFor(f.patientId ?? "", f.reason);
        return { label: `${a.label} · ${first(f.label)}`, to: a.to };
      }),
    });
  }

  // Intenções que precisam de UM paciente.
  if (intent === "resumo_retorno" || intent === "rascunho_mensagem") {
    if (i.patientDenied) {
      return reply({ text: "Não tenho acesso a este paciente com o seu perfil, então não preparo nada dele.", blocked: "sem_acesso" });
    }
    if (!patientFacts) {
      return reply({ text: "Diga o nome do paciente ou abra a ficha dele para eu preparar isso. Uso só o que está registrado.", blocked: null });
    }
    const pid = patientFacts[0]?.patientId ?? null;
    const name = String(get(patientFacts, "nome")?.value ?? "");
    const reason = get(patientFacts, "motivos")?.reason ?? get(patientFacts, "ultimo_registro")?.reason ?? null;
    if (intent === "rascunho_mensagem") {
      const body = messageFor(name, reason);
      return reply({
        text: `Rascunho de mensagem para ${name}. Nada foi enviado.`,
        draft: {
          kind: "mensagem", title: `Mensagem para ${name}`, patientId: pid, patientName: name, body,
          fields: [
            { label: "Motivo", value: String(get(patientFacts, "motivos")?.value ?? get(patientFacts, "ultimo_registro")?.value ?? "—"), source: "Foco do dia", uncertain: !get(patientFacts, "motivos") },
            { label: "Tom", value: "Acolhedor e direto", source: "Padrão da Vertexa IA" },
          ],
        },
        actions: pid ? [{ label: "Abrir conversa", to: `/mensagens?patient=${pid}` }] : [],
      });
    }
    const keys = ["peso", "meta", "imc", "adesao", "ultimo_registro", "sinais", "objetivo", "motivos", "proximo"];
    const fields = keys.map((k) => get(patientFacts, k)).filter((f): f is Fact => Boolean(f)).map((f) => ({
      label: f.label, value: String(f.value), source: f.source, uncertain: f.uncertain,
    }));
    const body = `Resumo para o retorno de ${name}\n` + fields.map((f) => `• ${f.label}: ${f.value} (${f.source})`).join("\n");
    return reply({
      text: `Resumo para o retorno de ${name}. É um rascunho: nada foi salvo no prontuário.`,
      items: fields.map((f) => ({ text: `${f.label}: ${f.value}`, source: f.source, uncertain: f.uncertain })),
      draft: { kind: "resumo_retorno", title: `Retorno de ${first(name)}`, patientId: pid, patientName: name, body, fields },
      actions: pid ? [{ label: "Abrir ficha", to: `/pacientes/${pid}` }] : [],
    });
  }

  return reply({
    text:
      i.screen.screen === "paciente"
        ? "Posso preparar o resumo para o retorno ou um rascunho de mensagem deste paciente. Tudo nasce como rascunho."
        : "Posso resumir quem precisa de você hoje, listar a agenda, ver quem está sem registrar e rascunhar mensagens. Tudo nasce como rascunho.",
  });
}
