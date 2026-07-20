import { FileText, ImageOff, Loader2 } from "lucide-react";

import { useChatAttachmentUrl } from "@/hooks/useChat";
import { chatAttachmentKind } from "@/lib/domain/chatAttachment";
import { formatFileSize } from "@/lib/domain/format";
import { cn } from "@/lib/utils";

/**
 * Exibe o anexo de uma mensagem do chat (bucket PRIVADO): imagem → pré-visualização; PDF/outros →
 * cartão de arquivo com nome e tamanho. A URL é ASSINADA sob demanda (TTL curto) e abre em nova aba.
 */
export function ChatAttachment({
  path,
  name,
  mime,
  size,
  align = "start",
}: {
  path: string;
  name: string | null;
  mime: string | null;
  size: number | null;
  align?: "start" | "end";
}) {
  const { data: url, isLoading, isError } = useChatAttachmentUrl(path);
  const kind = chatAttachmentKind(mime);
  const label = name ?? (kind === "image" ? "Imagem" : "Arquivo");

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        aria-label="Carregando anexo"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando anexo…
      </div>
    );
  }

  if (isError || !url) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
        Não foi possível carregar o anexo.
      </div>
    );
  }

  if (kind === "image") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Abrir imagem ${label}`}
      >
        <img
          src={url}
          alt={label}
          loading="lazy"
          className="max-h-56 w-auto max-w-full object-cover"
        />
      </a>
    );
  }

  // PDF / documento: cartão com nome + tamanho, abre em nova aba.
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex max-w-[16rem] items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        align === "end" && "ml-auto",
      )}
      aria-label={`Abrir arquivo ${label}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden>
        <FileText className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{formatFileSize(size)}</span>
      </span>
    </a>
  );
}
