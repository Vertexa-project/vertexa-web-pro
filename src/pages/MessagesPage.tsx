import { useEffect, useState } from "react";
import { Bot, MessageSquare, Send } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/status/StatusBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatThread, useSendChatMessage } from "@/hooks/useChat";
import { useListPatients } from "@/hooks/usePatients";
import { formatRelative, initials } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import type { PatientListItem } from "@/types/db";

function Thread({ patient }: { patient: PatientListItem }) {
  const { data, isLoading, isError, refetch } = useChatThread(patient.id);
  const sendMessage = useSendChatMessage(patient.id);
  const [draft, setDraft] = useState("");
  const patientName = patient.profile?.full_name ?? "Paciente";

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const messages = data?.messages ?? [];
  // Sem participante profissional no canal não há remetente válido em modo demo.
  const canSend = Boolean(data?.actingProfileId);

  const handleSend = () => {
    const body = draft.trim();
    if (!body || !data?.channelId || !data.actingProfileId || sendMessage.isPending) return;
    sendMessage.mutate(
      { channelId: data.channelId, senderProfileId: data.actingProfileId, body },
      { onSuccess: () => setDraft("") },
    );
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
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                    fromPatient ? "bg-muted text-foreground" : "bg-primary/10 text-foreground",
                  )}
                >
                  {m.body}
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
        <div className="flex items-center gap-2">
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
            disabled={!canSend || sendMessage.isPending || draft.trim().length === 0}
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {sendMessage.isError ? (
          <p className="mt-2 text-[11px] text-destructive">
            Não foi possível enviar. Tente novamente.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Você responde no lugar da clínica/profissional — sempre com um humano no controle.
          </p>
        )}
      </div>
    </div>
  );
}

export function MessagesPage() {
  const { data, isLoading, isError, refetch } = useListPatients();
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
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  aria-pressed={p.id === selectedId}
                  aria-label={`Conversa com ${name}`}
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
