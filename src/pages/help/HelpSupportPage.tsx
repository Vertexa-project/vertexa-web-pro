import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Mail, MessageCircle, MessageCircleQuestion } from "lucide-react";

import { LoadingState } from "@/components/feedback/LoadingState";
import { ImagePicker } from "@/components/support/SupportConversation";
import { SupportTicketList } from "@/components/support/SupportTicketList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useHelpSettings } from "@/hooks/useHelpAdmin";
import { useHelpCenterAccess } from "@/hooks/useHelpCenter";
import { formatWhatsapp, whatsappLink } from "@/lib/api/helpAdmin";
import { useMySupportTickets, useOpenSupportTicket, useSupportClinics } from "@/hooks/useSupport";
import { SUPPORT_CATEGORY_LABEL, validateSupportImage, type SupportCategory } from "@/lib/api/support";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function OpenTicketForm({ clinics }: { clinics: { clinicId: string; clinicName: string }[] }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const open = useOpenSupportTicket();
  const [clinicId, setClinicId] = useState(clinics[0]?.clinicId ?? "");
  const [category, setCategory] = useState<SupportCategory>("duvida");
  const [subject, setSubject] = useState(() => (params.get("assunto") ?? "").slice(0, 140));
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageError = validateSupportImage(image);
  const valid = clinicId && subject.trim().length >= 3 && body.trim().length > 0 && !imageError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!valid) {
      setError("Preencha o assunto (pelo menos 3 letras) e a descrição.");
      return;
    }
    try {
      const r = await open.mutateAsync({ clinicId, subject: subject.trim(), category, body: body.trim(), image });
      navigate(`/ajuda/suporte/${r.ticketId}`, {
        state: { opened: r.number, attachmentFailed: r.attachmentFailed },
      });
    } catch {
      setError("Não foi possível abrir o chamado. Tente de novo.");
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm" noValidate>
      <h2 className="text-lg font-semibold tracking-tight">Abrir um chamado</h2>
      {clinics.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="support-clinic">Clínica</Label>
          <select id="support-clinic" className={selectClass} value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
            {clinics.map((c) => (
              <option key={c.clinicId} value={c.clinicId}>
                {c.clinicName}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="support-category">Tipo</Label>
          <select
            id="support-category"
            className={selectClass}
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportCategory)}
          >
            {(Object.keys(SUPPORT_CATEGORY_LABEL) as SupportCategory[]).map((k) => (
              <option key={k} value={k}>
                {SUPPORT_CATEGORY_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="support-subject">Assunto</Label>
          <Input
            id="support-subject"
            value={subject}
            maxLength={140}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ex.: Não consigo remarcar uma consulta"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="support-body">Descreva o que aconteceu</Label>
        <Textarea
          id="support-body"
          className="min-h-[130px]"
          value={body}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Conte o que você tentou fazer, em qual tela, e o que apareceu."
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ImagePicker id="support-image" file={image} onChange={setImage} error={imageError} />
        <Button type="submit" className="ml-auto" disabled={open.isPending}>
          {open.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Enviar chamado
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function SupportContact() {
  const settings = useHelpSettings();
  const s = settings.data;
  if (!s) return null;
  const wa = whatsappLink(s.supportWhatsapp);
  if (!wa && !s.supportEmail) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Prefere falar direto?</p>
        {s.supportHours ? <p className="text-muted-foreground">Atendimento: {s.supportHours}</p> : null}
      </div>
      {wa ? (
        <Button asChild>
          <a href={wa} target="_blank" rel="noreferrer">
            <MessageCircle className="h-4 w-4" aria-hidden />
            WhatsApp {formatWhatsapp(s.supportWhatsapp)}
          </a>
        </Button>
      ) : null}
      {s.supportEmail ? (
        <Button asChild variant="outline">
          <a href={`mailto:${s.supportEmail}`}>
            <Mail className="h-4 w-4" aria-hidden />
            {s.supportEmail}
          </a>
        </Button>
      ) : null}
    </div>
  );
}

export function HelpSupportPage() {
  const access = useHelpCenterAccess();
  const clinics = useSupportClinics();
  const tickets = useMySupportTickets();
  const hasClinic = (clinics.data?.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-10">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageCircleQuestion className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Suporte</h1>
          <p className="mt-1 text-muted-foreground">
            Não achou nos tutoriais? Abra um chamado: a equipe Vertexa responde por aqui e você recebe um aviso no menu
            do Vertexa.
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-8">
        <SupportContact />
        {clinics.isLoading ? (
          <div className="flex justify-center py-10">
            <LoadingState />
          </div>
        ) : hasClinic ? (
          <OpenTicketForm clinics={clinics.data ?? []} />
        ) : access.data?.platformAdmin ? (
          <div className="rounded-2xl border border-border bg-card p-5 text-sm">
            Os chamados das clínicas ficam na Plataforma.{" "}
            <Link to="/platform/suporte" className="font-medium text-primary underline-offset-4 hover:underline">
              Abrir Plataforma › Suporte
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sua conta não está ligada a uma clínica assinante.</p>
        )}

        {hasClinic ? (
          <section aria-labelledby="meus-chamados" className="space-y-3">
            <h2 id="meus-chamados" className="text-lg font-semibold tracking-tight">
              Meus chamados
            </h2>
            {tickets.isLoading ? (
              <LoadingState />
            ) : tickets.isError ? (
              <p className="text-sm text-destructive">Não foi possível carregar seus chamados.</p>
            ) : (tickets.data ?? []).length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Você ainda não abriu nenhum chamado.
              </p>
            ) : (
              <SupportTicketList tickets={tickets.data ?? []} side="clinica" basePath="/ajuda/suporte" />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
