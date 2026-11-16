import { createContext, useContext } from "react";

import type { ChatMessage, DraftAction } from "@/lib/domain/vertexaAi";
import type { AiScreenContext } from "@/types/vertexaAi";

export interface VertexaAiContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Abre o painel e, se vier texto, já faz o pedido (um evento do profissional; nunca em loop). */
  openWith: (prompt?: string) => void;
  screen: AiScreenContext;
  /** "Hoje", "Mariana Teste · Resumo"… (o que o painel mostra em "Vendo:"). */
  contextText: string;
  messages: ChatMessage[];
  pending: boolean;
  ask: (text: string) => Promise<void>;
  actOnDraft: (messageId: string, action: DraftAction, editedText?: string) => void;
  /** Modo da última resposta (demo = sem chave OpenAI). */
  mode: "demo" | "openai" | null;
}

export const VertexaAiContext = createContext<VertexaAiContextValue | undefined>(undefined);

export function useVertexaAi(): VertexaAiContextValue {
  const ctx = useContext(VertexaAiContext);
  if (!ctx) throw new Error("useVertexaAi deve ser usado dentro de <VertexaAiProvider>");
  return ctx;
}
