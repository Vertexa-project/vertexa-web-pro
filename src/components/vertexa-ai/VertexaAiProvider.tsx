import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { VertexaAiPanel } from "./VertexaAiPanel";
import { VertexaAiContext, type VertexaAiContextValue } from "./vertexa-ai-context";
import { useCurrentProfessionalName } from "@/hooks/useCurrentProfessional";
import { usePatient } from "@/hooks/usePatients";
import { askVertexaAi, friendlyAiError, resolveVertexaDraft } from "@/lib/api/vertexaAi";
import { shortName } from "@/lib/domain/format";
import {
  applyDraftAction,
  assistantMessage,
  contextLabel,
  hourBR,
  introMessage,
  patchDraft,
  pushMessage,
  screenFromLocation,
  stashMessageDraft,
  type ChatMessage,
  type DraftAction,
} from "@/lib/domain/vertexaAi";

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${(seq += 1)}`;

/** Painel da Vertexa IA: um por sessão do app, disponível em todas as telas autenticadas. */
export function VertexaAiProvider({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { data: professionalName } = useCurrentProfessionalName();
  const screen = useMemo(() => screenFromLocation(pathname, search), [pathname, search]);
  const { data: patient } = usePatient(screen.patientId ?? "");
  const contextText = contextLabel(screen, patient?.profile?.full_name ?? null);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"demo" | "openai" | null>(null);
  const screenRef = useRef(screen);
  const contextRef = useRef(contextText);
  screenRef.current = screen;
  contextRef.current = contextText;
  const busy = useRef(false);

  const ask = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy.current) return;
    busy.current = true;
    const ctxText = contextRef.current;
    setMessages((m) => pushMessage(m, { id: nextId(), role: "user", text: t, context: ctxText }));
    setPending(true);
    try {
      const res = await askVertexaAi(t, screenRef.current);
      setMode(res.mode);
      setMessages((m) => pushMessage(m, assistantMessage(nextId(), res, ctxText)));
    } catch (e) {
      const text = friendlyAiError(e instanceof Error ? e.message : "");
      setMessages((m) => pushMessage(m, { id: nextId(), role: "assistant", text, context: ctxText, error: true }));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  const openWith = useCallback(
    (prompt?: string) => {
      setOpen(true);
      if (prompt) void ask(prompt);
    },
    [ask],
  );

  const actOnDraft = useCallback(
    (messageId: string, action: DraftAction, editedText?: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg?.draft) return;
      const base = editedText != null ? { ...msg.draft, text: editedText } : msg.draft;
      const { view, effect } = applyDraftAction(base, action);
      setMessages((list) => patchDraft(list, messageId, view));
      if (action === "usar") void resolveVertexaDraft(msg.requestId, "usado");
      if (action === "descartar") void resolveVertexaDraft(msg.requestId, "descartado");
      // "Usar" só ENTREGA o texto ao profissional (copiar / campo de resposta). Nada é salvo nem enviado aqui.
      if (effect.type === "preencher_mensagem") {
        stashMessageDraft(effect.patientId, effect.text);
        setOpen(false);
        navigate(effect.to);
      } else if (effect.type === "copiar_e_abrir") {
        void navigator.clipboard?.writeText(effect.text).catch(() => undefined);
        if (effect.to) {
          setOpen(false);
          navigate(effect.to);
        }
      }
    },
    [messages, navigate],
  );

  // ⌘K / Ctrl+K abre e fecha o painel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const intro = useMemo(
    () => introMessage(shortName(professionalName), contextText, hourBR()),
    [professionalName, contextText],
  );

  const value: VertexaAiContextValue = useMemo(
    () => ({ open, setOpen, openWith, screen, contextText, messages, pending, ask, actOnDraft, mode }),
    [open, openWith, screen, contextText, messages, pending, ask, actOnDraft, mode],
  );

  return (
    <VertexaAiContext.Provider value={value}>
      {children}
      <VertexaAiPanel intro={intro} />
    </VertexaAiContext.Provider>
  );
}
