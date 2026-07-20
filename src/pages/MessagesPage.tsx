import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageSquare, Paperclip, Send, X } from "lucide-react";

import { ChatAttachment } from "@/components/chat/ChatAttachment";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/status/StatusBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useChatThread,
  useMarkMentionsRead,
  useSendChatMessage,
  useUnreadMentions,
} from "@/hooks/useChat";
import { useListPatients } from "@/hooks/usePatients";
import { CHAT_ATTACHMENT_MIME, hasChatAttachment, validateChatAttachment } from "@/lib/domain/chatAttachment";
import { formatRelative, initials } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import type { PatientListItem } from "@/types/db";

function Thread({ patient }: { patient: PatientListItem }) {
  const { data, isLoading, isError, refetch } = useChatThread(patient.id);
  const sendMessage = useSendChatMessage(patient.id);
  const { data: mentions } = useUnreadMentions();
  const { mutate: markRead } = useMarkMentionsRead();
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patientName = patient.profile?.full_name ?? "Paciente";

  const channelId = data?.channelId;
  const unreadForPatient = mentions?.byPatient[patient.id] ?? 0;

  // Ao abrir uma conversa com menções pendentes, marca como lidas (limpa o badge).
  useEffect(() => {
    if (channelId && unreadForPatient > 0) markRead(channelId);
  }, [channelId, unreadForPatient, markRead]);

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const messages = data?.messages ?? [];
  // Sem profissional atuante configurado (env) não há remetente válido em modo demo.
  const canSend = Boolean(data?.actingProfileId);
  const hasContent = draft.trim().length > 0 || file !== null;

  const handleSend = () => {
    const body = draft.trim();
    if ((!body && !file) || !data?.channelId || !data.actingProfileId || sendMessage.isPending) return;
    sendMessage.mutate(
      { channelId: data.channelId, senderProfileId: data.actingProfileId, body: body || null, file },
      {
        onSuccess: () => {
          setDraft("");
          setFile(null);
          setAttachError(null);
        },
      },
    );
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!picked) return;
    const invalid = validateChatAttachment(picked); // valida tipo/tamanho ANTES do upload
    if (invalid) {
      setAttachError(invalid);
      setFile(null);
      return;
    }
    setAttachError(null);
    setFile(picked);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-5 py-3">
        <p className="font-medium text-foreground">{patientName}</p>
        <p className="text-xs text-muted-foreground">Conversa com o paciente</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma mensagem nesta conversa ainda.
          </p>
        ) : (
          messages.map((m) => {
            const fromPatient = m.sender_role === "patient";
            // Remetente do profissional = nome da clínica/profissional, NUNCA "Vertexa".
            const author = fromPatient ? patientName : m.sender_name ?? "Profissional";
            return (
              <div key={m.id} className={cn("flex flex-col", fromPatient ? "items-start" : "items-end")}>
                <span className="mb-1 text-xs text-muted-foreground">{author}</span>
                <div
                  className={cn(
                    "max-w-[80%] space-y-2 rounded-lg px-3 py-2 text-sm",
                    fromPatient ? "bg-muted text-foreground" : "bg-primary/10 text-foreground",
                  )}
                >
                  {/* body é ANULÁVEL: mensagem só-anexo não tem texto. */}
                  {m.body ? <p className="whitespace-pre-wrap">{m.body}</p> : null}
                  {hasChatAttachment(m) ? (
                    <ChatAttachment
                      path={m.attachment_path as string}
                      name={m.attachment_name}
                      mime={m.attachment_mime}
                      size={m.attachment_size}
                      align={fromPatient ? "start" : "end"}
                    />
                  ) : null}
                </div>
                <time dateTime={m.created_at} className="mt-1 text-xs text-muted-foreground">
                  {formatRelative(m.created_at)}
                </time>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t p-3">
        {/* Anexo selecionado (chip com remover) */}
        {file ? (
          <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">{file.name}</span>
            <button
              type="button"
              onClick={() => setFile(null)}
              disabled={sendMessage.isPending}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Remover anexo"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {attachError ? (
          <p className="mb-2 text-xs text-destructive" role="alert">
            {attachError}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={CHAT_ATTACHMENT_MIME.join(",")}
            className="hidden"
            onChange={handlePickFile}
            aria-hidden
            tabIndex={-1}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canSend || sendMessage.isPending}
            title="Anexar arquivo (PDF ou imagem)"
            aria-label="Anexar arquivo"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={canSend ? "Escreva uma mensagem…" : "Sem profissional vinculado a esta conversa"}
            disabled={!canSend || sendMessage.isPending}
            aria-label="Mensagem"
          />
          <Button variant="outline" size="icon" disabled title="Responder com IA (em breve)" aria-label="Responder com IA">
            <Bot className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!canSend || sendMessage.isPending || !hasContent}
            aria-label="Enviar"
          >
            {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        {sendMessage.isError ? (
          <p className="mt-2 text-xs text-destructive">
            Não foi possível enviar. Verifique o arquivo e tente novamente.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Você responde no lugar da clínica/profissional — sempre com um humano no controle.
          </p>
        )}
      </div>
    </div>
  );
}

export function MessagesPage() {
  const { data, isLoading, isError, refetch } = useListPatients();
  const { data: mentions } = useUnreadMentions();
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!selectedId && data && data.length > 0) setSelectedId(data[0].id);
  }, [data, selectedId]);

  const selected = data?.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="Mensagens" description="Central de conversas com os seus pacientes." />

      {isLoading ? (
        <Skeleton className="h-[28rem] w-full" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Nenhuma conversa"
          description="As conversas com os seus pacientes aparecerão aqui."
        />
      ) : (
        <Card className="grid h-[32rem] grid-cols-1 overflow-hidden lg:grid-cols-[320px_1fr]">
          <div className="max-h-48 overflow-y-auto border-b lg:max-h-none lg:border-b-0 lg:border-r">
            {(data ?? []).map((p) => {
              const name = p.profile?.full_name ?? "Sem nome";
              const mentionCount = mentions?.byPatient[p.id] ?? 0;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  aria-pressed={p.id === selectedId}
                  aria-label={
                    mentionCount > 0
                      ? `Conversa com ${name}, ${mentionCount} menção(ões) não lida(s)`
                      : `Conversa com ${name}`
                  }
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    p.id === selectedId && "bg-muted/60",
                  )}
                >
                  <Avatar>
                    <AvatarFallback>{initials(name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{name}</p>
                    <div className="mt-0.5">
                      <StatusBadge status={p.snapshot?.status} score={p.snapshot?.score} />
                    </div>
                  </div>
                  {mentionCount > 0 ? (
                    <Badge
                      tone="primary"
                      className="h-5 min-w-5 shrink-0 justify-center px-1.5 tabular-nums"
                      aria-hidden
                    >
                      {mentionCount > 99 ? "99+" : mentionCount}
                    </Badge>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="min-h-0">
            {selected ? (
              <Thread patient={selected} />
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MessageSquare className="h-4 w-4" />
                  Selecione uma conversa.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
