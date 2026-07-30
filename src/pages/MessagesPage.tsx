import { useEffect, useRef, useState } from "react";
import { AlertTriangle, AtSign, Bot, CornerUpLeft, Loader2, MessageSquare, Paperclip, Send, X } from "lucide-react";

import { ChatAttachment } from "@/components/chat/ChatAttachment";
import { ChatReplyQuote } from "@/components/chat/ChatReplyQuote";
import { MentionPicker } from "@/components/chat/MentionPicker";
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
  useChannelProfessionals,
  useChatThread,
  useMarkMentionsRead,
  useSendChatMessage,
  useUnreadMentions,
} from "@/hooks/useChat";
import { useDisciplinesList } from "@/hooks/useDisciplines";
import { useListPatients } from "@/hooks/usePatients";
import { chatStageOf } from "@/lib/api/chat";
import { CHAT_ATTACHMENT_MIME, hasChatAttachment, validateChatAttachment } from "@/lib/domain/chatAttachment";
import { mentionFailureMessage } from "@/lib/domain/chatMention";
import { indexById, quotedPreview, resolveQuote } from "@/lib/domain/chatReply";
import { mentionableProfessionals, mentionsProfile, namesByProfileId } from "@/lib/domain/chatTeam";
import { formatRelative, initials } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import type { ChannelProfessional, ChatMessageView, PatientListItem } from "@/types/db";

function Thread({ patient }: { patient: PatientListItem }) {
  const { data, isLoading, isError, error, refetch } = useChatThread(patient.id);
  const sendMessage = useSendChatMessage(patient.id);
  const { data: mentions } = useUnreadMentions();
  const { mutate: markRead } = useMarkMentionsRead();
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mention, setMention] = useState<ChannelProfessional | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null);
  const [mentionWarning, setMentionWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patientName = patient.profile?.full_name ?? "Paciente";

  const channelId = data?.channelId;
  const actingProfileId = data?.actingProfileId ?? null;
  const unreadForPatient = mentions?.byPatient[patient.id] ?? 0;

  // ⚠️ DUAS PERGUNTAS, DUAS CHAMADAS (WP-FRONT-2bii-A item 2). Até aqui as duas dividiam UMA
  // chamada, e isso não sobrevive à desativação de profissional: a mesma lista servia para
  // "quem posso marcar" e para "quem escreveu isto", que passam a ter respostas diferentes.
  //   rosterQuery  (false) → SELETOR DE @: só quem participa do canal AGORA.
  //   authorsQuery (true)  → NOME DO AUTOR: roster ∪ autores das mensagens, para o histórico não
  //                          perder a autoria de quem saiu.
  // Carregadas junto da conversa — não só ao abrir o seletor — porque o botão de @ precisa
  // responder na hora e o nome do autor aparece na primeira bolha.
  const rosterQuery = useChannelProfessionals(channelId, false);
  const authorsQuery = useChannelProfessionals(channelId, true);
  // Rótulos de disciplina vêm do BANCO (public.disciplines), não hardcodados na UI.
  const { data: disciplines } = useDisciplinesList();
  const labelByCode = new Map((disciplines ?? []).map((d) => [d.code, d.label]));
  // O próprio profissional sai da lista: marcar a si mesmo só acenderia o próprio badge.
  const mentionable = mentionableProfessionals(rosterQuery.data, actingProfileId);

  // Ao abrir uma conversa com menções pendentes, marca como lidas (limpa o badge).
  // É o MESMO caminho de leitura de sempre (item 5 manda reusar, e não abrir um segundo).
  useEffect(() => {
    if (channelId && unreadForPatient > 0) markRead(channelId);
  }, [channelId, unreadForPatient, markRead]);

  // Trocar de conversa não pode carregar marcação, citação nem aviso da conversa anterior.
  useEffect(() => {
    setMention(null);
    setReplyTo(null);
    setMentionWarning(null);
    setPickerOpen(false);
  }, [patient.id]);

  if (isLoading) return <LoadingState />;
  // DOIS modos de falha distintos. Antes, os dois viravam o mesmo "Não foi possível carregar",
  // o que fez o 42501 da CRIAÇÃO do canal parecer problema de histórico.
  if (isError) {
    return chatStageOf(error) === "messages" ? (
      <ErrorState
        title="Não foi possível carregar as mensagens"
        description="A conversa foi aberta, mas o histórico não veio. Tente novamente."
        onRetry={() => refetch()}
      />
    ) : (
      <ErrorState
        title="Não foi possível abrir a conversa"
        description="Não conseguimos abrir ou criar a conversa com este paciente. Verifique se você continua vinculado a ele e tente novamente."
        onRetry={() => refetch()}
      />
    );
  }

  const messages = data?.messages ?? [];
  // Sem profissional atuante configurado (env) não há remetente válido em modo demo.
  const canSend = Boolean(data?.actingProfileId);
  const hasContent = draft.trim().length > 0 || file !== null;

  // Índice para a citação. A lista carrega o canal INTEIRO (sem paginação), então a mensagem
  // citada está sempre aqui — a degradação existe para o caso em que não estiver, não como enfeite.
  const byId = indexById(messages);
  /**
   * Autor exibido. Remetente do profissional = nome da clínica/profissional, NUNCA "Vertexa".
   *
   * ⚠️ POR QUE O `sender_name` NÃO BASTA: o embed `profiles` do remetente chega NULO quando quem
   * escreveu é um COLEGA — `profiles_select` é `private.can_see_profile(id)`, e nenhum dos seus 4
   * ramos (sou eu / é paciente que alcanço / sou admin da clínica dele / eu sou a paciente) cobre
   * "colega da mesma clínica". Verificado em produção. A bolha caía para o genérico "Profissional".
   *
   * A RPC `channel_professionals` já devolve nome de TODOS os participantes profissionais — e,
   * com `p_include_message_authors = true`, também de quem AUTOROU mensagem e não está mais no
   * roster. É de lá que o nome vem, sem nenhuma leitura nova.
   *
   * `authorOf` continua sendo UM lugar só, servindo a bolha E a citação: as duas nunca podem
   * discordar sobre a mesma pessoa. O que mudou é que ele passa a beber SÓ da lista com autores
   * (`authorsQuery`) — nunca da lista do seletor, que é propositalmente mais curta.
   */
  const nameByProfile = namesByProfileId(authorsQuery.data ?? []);
  const authorOf = (m: ChatMessageView) =>
    m.sender_role === "patient"
      ? patientName
      : m.sender_name
        ?? (m.sender_profile_id ? nameByProfile.get(m.sender_profile_id) : null)
        ?? "Profissional";

  const handleSend = () => {
    const body = draft.trim();
    if ((!body && !file) || !data?.channelId || !data.actingProfileId || sendMessage.isPending) return;
    // Guardado ANTES do envio: o estado é limpo no sucesso e o aviso precisa do nome de quem o
    // profissional TENTOU marcar.
    const marked = mention;
    sendMessage.mutate(
      {
        channelId: data.channelId,
        senderProfileId: data.actingProfileId,
        body: body || null,
        file,
        mentionedProfileId: marked?.profileId ?? null,
        // Vai cru: a FK COMPOSTA (reply_to_message_id, channel_id) é quem garante o mesmo canal.
        replyToMessageId: replyTo?.id ?? null,
      },
      {
        onSuccess: (result) => {
          setDraft("");
          setFile(null);
          setAttachError(null);
          setMention(null);
          setReplyTo(null);
          setPickerOpen(false);

          // A MENSAGEM ENTROU. Se só a marcação falhou, o texto diz isso e nada mais — não manda
          // tentar de novo (reenviar duplicaria) e não culpa quem escreveu.
          if (result.mentionFailed && marked) {
            setMentionWarning(mentionFailureMessage(marked.name, result.mentionFailureReason ?? "unknown"));
            // A lista que ele usou está VELHA — foi ela que ofereceu alguém que já saiu. É o
            // ROSTER que precisa ser recarregado (a lista de autores não oferece marcação).
            void rosterQuery.refetch();
          } else {
            setMentionWarning(null);
          }
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
            const author = authorOf(m);
            // Citação resolvida contra a própria lista. `null` = não é resposta; found=false =
            // degradou para "Mensagem original indisponível" (nunca quebra, nunca some).
            const quote = resolveQuote(m, byId, authorOf);
            const mentionsMe = mentionsProfile(m, actingProfileId);
            return (
              <div key={m.id} className={cn("flex flex-col", fromPatient ? "items-start" : "items-end")}>
                <span className="mb-1 text-xs text-muted-foreground">{author}</span>
                <div
                  className={cn(
                    "max-w-[80%] space-y-2 rounded-lg px-3 py-2 text-sm",
                    fromPatient ? "bg-muted text-foreground" : "bg-primary/10 text-foreground",
                    // Item 5 — destaque de quem foi marcado. Anel + faixa; não é só cor (contraste).
                    mentionsMe && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                  )}
                >
                  {mentionsMe ? (
                    <p className="flex items-center gap-1 text-xs font-medium text-primary">
                      <AtSign className="h-3 w-3" aria-hidden />
                      Você foi marcado nesta mensagem
                    </p>
                  ) : null}
                  {quote ? <ChatReplyQuote quote={quote} /> : null}
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
                <div className="mt-1 flex items-center gap-2">
                  <time dateTime={m.created_at} className="text-xs text-muted-foreground">
                    {formatRelative(m.created_at)}
                  </time>
                  <button
                    type="button"
                    onClick={() => setReplyTo(m)}
                    disabled={!canSend}
                    className="flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    aria-label={`Responder à mensagem de ${author}`}
                  >
                    <CornerUpLeft className="h-3 w-3" aria-hidden />
                    Responder
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t p-3">
        {/* Aviso da MENÇÃO que não entrou. Fica na tela até ser fechado — não é toast: some antes
            de ser lido e o profissional acharia que marcou alguém que não foi marcado. */}
        {mentionWarning ? (
          <div
            className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{mentionWarning}</span>
            <button
              type="button"
              onClick={() => setMentionWarning(null)}
              className="shrink-0 rounded p-0.5 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Fechar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {/* Mensagem que está sendo respondida (chip com cancelar) */}
        {replyTo ? (
          <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">
              Respondendo a {authorOf(replyTo)}: {quotedPreview(replyTo, 60)}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              disabled={sendMessage.isPending}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Cancelar resposta"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {/* Profissional marcado (chip com remover) */}
        {mention ? (
          <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs">
            <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">Marcando {mention.name}</span>
            <button
              type="button"
              onClick={() => setMention(null)}
              disabled={sendMessage.isPending}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Remover marcação"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

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

          {/* Seletor de @ — o painel abre SEMPRE que o botão é clicado, inclusive para mostrar
              erro. Nunca "o @ não faz nada". */}
          <div
            className="relative"
            onKeyDown={(e) => {
              if (e.key === "Escape" && pickerOpen) {
                e.stopPropagation();
                setPickerOpen(false);
              }
            }}
          >
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPickerOpen((open) => !open)}
              disabled={!canSend || sendMessage.isPending}
              title="Marcar um profissional"
              aria-label="Marcar um profissional"
              aria-expanded={pickerOpen}
            >
              <AtSign className="h-4 w-4" />
            </Button>
            {pickerOpen ? (
              <MentionPicker
                professionals={mentionable}
                isLoading={rosterQuery.isPending}
                isError={rosterQuery.isError}
                onRetry={() => void rosterQuery.refetch()}
                onPick={(p) => {
                  setMention(p);
                  setPickerOpen(false);
                }}
                labelByCode={labelByCode}
              />
            ) : null}
          </div>
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
