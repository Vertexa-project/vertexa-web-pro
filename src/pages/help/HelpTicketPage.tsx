import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

import { LoadingState } from "@/components/feedback/LoadingState";
import { SupportConversation } from "@/components/support/SupportConversation";
import { Button } from "@/components/ui/button";
import { useSupportTicket } from "@/hooks/useSupport";

export function SupportTicketView({ backTo, backLabel }: { backTo: string; backLabel: string }) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const ticket = useSupportTicket(id);
  const opened = (location.state as { opened?: number; attachmentFailed?: boolean } | null) ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
        <Link to={backTo}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {backLabel}
        </Link>
      </Button>
      {opened?.opened ? (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <span>
            Chamado nº {opened.opened} aberto. A resposta aparece aqui e você recebe um aviso no menu do Vertexa.
            {opened.attachmentFailed ? " A imagem não foi anexada; envie de novo na resposta." : ""}
          </span>
        </div>
      ) : null}
      {ticket.isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingState />
        </div>
      ) : ticket.isError || !ticket.data ? (
        <div className="py-12 text-center">
          <h1 className="text-xl font-semibold">Chamado não encontrado</h1>
          <p className="mt-2 text-muted-foreground">Ele não existe ou você não tem acesso a ele.</p>
        </div>
      ) : (
        <SupportConversation ticket={ticket.data} />
      )}
    </div>
  );
}

export function HelpTicketPage() {
  return <SupportTicketView backTo="/ajuda/suporte" backLabel="Meus chamados" />;
}
