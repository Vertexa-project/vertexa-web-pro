import { useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SupportStatusBadge } from "@/components/support/SupportStatusBadge";
import {
  useReplySupportTicket,
  useSetSupportStatus,
  useSupportAttachmentUrl,
} from "@/hooks/useSupport";
import { SUPPORT_CATEGORY_LABEL, validateSupportImage, type SupportTicketDetail } from "@/lib/api/support";
import { formatSupportDateTime } from "@/lib/help/supportFormat";
import { cn } from "@/lib/utils";

function Attachment({ path }: { path: string }) {
  const url = useSupportAttachmentUrl(path);
  if (url.isLoading) return <p className="mt-2 text-xs text-muted-foreground">Carregando imagem…</p>;
  if (!url.data) return <p className="mt-2 text-xs text-muted-foreground">Imagem indisponível.</p>;
  return (
    <a href={url.data} target="_blank" rel="noreferrer" className="mt-2 block w-fit">
      <img
        src={url.data}
        alt="Imagem anexada"
        className="max-h-64 max-w-full rounded-lg border border-border object-contain"
        loading="lazy"
      />
    </a>
  );
}

export function ImagePicker({
  file,
  onChange,
  error,
  id,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  error: string | null;
  id: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1">
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm">
          <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Tirar a imagem"
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden />
          Anexar print (opcional)
        </Button>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function SupportConversation({ ticket }: { ticket: SupportTicketDetail }) {
  const side = ticket.viewerSide;
  const reply = useReplySupportTicket(ticket.id);
  const status = useSetSupportStatus(ticket.id);
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const imageError = validateSupportImage(image);

  async function send() {
    setNotice(null);
    if (!body.trim() || imageError) return;
    try {
      const r = await reply.mutateAsync({ body: body.trim(), image });
      setBody("");
      setImage(null);
      setNotice(r.attachmentFailed ? "Mensagem enviada, mas a imagem não foi anexada. Tente anexar de novo." : "Mensagem enviada.");
    } catch {
      setNotice("Não foi possível enviar. Tente de novo.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              Chamado nº {ticket.number} · {SUPPORT_CATEGORY_LABEL[ticket.category]}
              {side === "vertexa" ? ` · ${ticket.clinicName}` : ""}
            </p>
            <h1 className="mt-1 break-words text-xl font-semibold tracking-tight md:text-2xl">{ticket.subject}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Aberto em {formatSupportDateTime(ticket.createdAt)}
              {ticket.openedByName ? ` por ${ticket.openedByName}` : ""}
            </p>
          </div>
          <SupportStatusBadge status={ticket.status} side={side} />
        </div>
      </div>

      <ol className="space-y-3" aria-label="Conversa">
        {ticket.messages.map((m) => {
          const mine = m.authorSide === side;
          return (
            <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "min-w-0 max-w-[92%] rounded-2xl border px-4 py-3 md:max-w-[80%]",
                  m.authorSide === "vertexa" ? "border-primary/20 bg-primary/5" : "border-border bg-card",
                )}
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {m.authorSide === "vertexa" ? "Suporte Vertexa" : m.authorName ?? "Clínica"}
                  {m.authorSide === "vertexa" && side === "vertexa" && m.authorName ? ` (${m.authorName})` : ""} ·{" "}
                  {formatSupportDateTime(m.createdAt)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6">{m.body}</p>
                {m.attachmentPath ? <Attachment path={m.attachmentPath} /> : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <Label htmlFor="support-reply" className="text-sm font-medium">
          {ticket.status === "resolvido" ? "Escrever de novo (reabre o chamado)" : "Responder"}
        </Label>
        <Textarea
          id="support-reply"
          className="mt-2 min-h-[110px]"
          value={body}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={side === "clinica" ? "Escreva sua mensagem para o suporte" : "Escreva a resposta para a clínica"}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ImagePicker id="support-reply-image" file={image} onChange={setImage} error={imageError} />
          <div className="ml-auto flex flex-wrap gap-2">
            {ticket.status !== "resolvido" ? (
              <Button
                type="button"
                variant="outline"
                disabled={status.isPending}
                onClick={() => void status.mutateAsync("resolvido").catch(() => setNotice("Não foi possível marcar agora."))}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                Marcar como resolvido
              </Button>
            ) : side === "vertexa" ? (
              <Button
                type="button"
                variant="outline"
                disabled={status.isPending}
                onClick={() => void status.mutateAsync("aberto").catch(() => setNotice("Não foi possível reabrir agora."))}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Reabrir
              </Button>
            ) : null}
            <Button type="button" onClick={() => void send()} disabled={!body.trim() || Boolean(imageError) || reply.isPending}>
              {reply.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Enviar
            </Button>
          </div>
        </div>
        {notice ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
