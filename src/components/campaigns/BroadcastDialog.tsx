import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePreviewBroadcast, useSendBroadcast } from "@/hooks/useCampaigns";
import {
  AUDIENCE_LABEL, availableAudiences, BODY_MAX, isInactiveAudience, recipientsText, renderMessage, TITLE_MAX, validateBroadcast,
  type BroadcastAudience,
} from "@/lib/domain/campaigns";

interface Props { clinicId: string; isAdmin: boolean; open: boolean; onOpenChange: (o: boolean) => void }

/** Disparo manual: escolhe a audiência, vê quantos vão receber e confirma antes de enviar. */
export function BroadcastDialog({ clinicId, isAdmin, open, onOpenChange }: Props) {
  const audiences = availableAudiences(isAdmin);
  const [audience, setAudience] = useState<BroadcastAudience>("mine");
  const [days, setDays] = useState("7");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const preview = usePreviewBroadcast();
  const send = useSendBroadcast();

  useEffect(() => {
    if (!open) return;
    setAudience("mine"); setDays("7"); setTitle(""); setBody(""); setCount(null); setConfirming(false); setError(null); setDone(null);
  }, [open]);

  const daysNum = isInactiveAudience(audience) ? Number(days) : null;
  useEffect(() => {
    if (!open) return;
    setCount(null); setConfirming(false);
    if (isInactiveAudience(audience) && !(Number.isInteger(daysNum) && (daysNum ?? 0) >= 1 && (daysNum ?? 0) <= 365)) return;
    preview.mutate({ clinicId, audience, days: daysNum }, { onSuccess: setCount, onError: () => setError("Não foi possível contar os destinatários.") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, audience, days, clinicId]);

  function review() {
    const r = validateBroadcast({ title, body, audience, days });
    if (!r.ok) return setError(r.error);
    setError(null);
    setConfirming(true);
  }

  function confirm() {
    const r = validateBroadcast({ title, body, audience, days });
    if (!r.ok) return setError(r.error);
    send.mutate({ clinicId, audience: r.value.audience, days: r.value.days, title: r.value.title, body: r.value.body }, {
      onSuccess: (res) => setDone(res.recipients),
      onError: () => { setConfirming(false); setError("Não foi possível enviar. Nada foi enviado; tente de novo."); },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo disparo</DialogTitle>
          <DialogDescription>A mensagem aparece na caixa de notificações do app dos pacientes, em nome da clínica.</DialogDescription>
        </DialogHeader>
        {done !== null ? (
          <DialogBody>
            <p className="text-sm text-foreground" role="status">{done === 1 ? "Mensagem enviada para 1 paciente." : `Mensagem enviada para ${done} pacientes.`}</p>
          </DialogBody>
        ) : (
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bc-audience">Para quem</Label>
              <select id="bc-audience" value={audience} onChange={(e) => setAudience(e.target.value as BroadcastAudience)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {audiences.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
              </select>
            </div>
            {isInactiveAudience(audience) ? (
              <div className="space-y-2">
                <Label htmlFor="bc-days">Dias sem registrar</Label>
                <Input id="bc-days" inputMode="numeric" className="w-28" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {preview.isPending ? "Contando destinatários…" : count === null ? "" : recipientsText(count)}
            </p>
            <div className="space-y-2">
              <Label htmlFor="bc-title">Título</Label>
              <Input id="bc-title" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Aviso sobre a sua consulta" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bc-body">Mensagem</Label>
              <Textarea id="bc-body" rows={4} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Use {nome} para o primeiro nome do paciente." />
              <p className="text-xs text-muted-foreground">{body.length}/{BODY_MAX}</p>
            </div>
            {title.trim() || body.trim() ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3" aria-label="Pré-visualização">
                <p className="text-sm font-semibold text-foreground">{renderMessage(title, "Maria Souza")}</p>
                <p className="text-sm text-muted-foreground">{renderMessage(body, "Maria Souza")}</p>
              </div>
            ) : null}
            {confirming ? (
              <p className="rounded-md bg-warning/10 p-3 text-sm text-foreground" role="alert">
                Confirma o envio? {count === null ? "" : recipientsText(count)} Não dá para desfazer.
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          </DialogBody>
        )}
        <DialogFooter>
          {done !== null ? (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => (confirming ? setConfirming(false) : onOpenChange(false))} disabled={send.isPending}>{confirming ? "Voltar" : "Cancelar"}</Button>
              {confirming ? (
                <Button onClick={confirm} disabled={send.isPending || count === 0} aria-busy={send.isPending}>
                  {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Enviar agora
                </Button>
              ) : (
                <Button onClick={review} disabled={count === 0 || preview.isPending}>Revisar e enviar</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
