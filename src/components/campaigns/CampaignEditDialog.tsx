import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateCampaign } from "@/hooks/useCampaigns";
import { BODY_MAX, renderMessage, TITLE_MAX, triggerMeta, validateCampaignEdit } from "@/lib/domain/campaigns";
import type { Campaign } from "@/types/db";

interface Props { campaign: Campaign | null; open: boolean; onOpenChange: (o: boolean) => void }

/** Edita título, mensagem e dias de UMA automação. O paciente vê o texto na caixa de notificações do app. */
export function CampaignEditDialog({ campaign, open, onOpenChange }: Props) {
  const meta = triggerMeta(campaign?.trigger);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateCampaign();

  useEffect(() => {
    if (!open || !campaign) return;
    setError(null);
    setTitle(campaign.title ?? campaign.name);
    setBody(campaign.message_template ?? "");
    setDays(String(campaign.days_threshold ?? meta?.defaultDays ?? ""));
  }, [open, campaign, meta?.defaultDays]);

  function save() {
    if (!campaign) return;
    const r = validateCampaignEdit({ title, body, days }, meta);
    if (!r.ok) return setError(r.error);
    update.mutate(
      { id: campaign.id, title: r.value.title, body: r.value.body, ...(meta?.daysLabel ? { days: r.value.days } : {}) },
      {
        onSuccess: () => onOpenChange(false),
        onError: () => setError("Não foi possível salvar. Só o administrador da clínica edita as automações."),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar: {meta?.label ?? campaign?.name}</DialogTitle>
          <DialogDescription>Use {"{nome}"} para colocar o primeiro nome do paciente. A mensagem chega na caixa de notificações do app.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="camp-title">Título</Label>
            <Input id="camp-title" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="camp-body">Mensagem</Label>
            <Textarea id="camp-body" rows={4} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="text-xs text-muted-foreground">{body.length}/{BODY_MAX}</p>
          </div>
          {meta?.daysLabel ? (
            <div className="space-y-2">
              <Label htmlFor="camp-days">{meta.daysLabel}</Label>
              <Input id="camp-days" inputMode="numeric" className="w-28" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          ) : null}
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3" aria-label="Pré-visualização">
            <p className="text-xs font-medium text-muted-foreground">Como o paciente vê (exemplo com “Maria Souza”)</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{renderMessage(title, "Maria Souza")}</p>
            <p className="text-sm text-muted-foreground">{renderMessage(body, "Maria Souza")}</p>
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>Cancelar</Button>
          <Button onClick={save} disabled={update.isPending} aria-busy={update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
