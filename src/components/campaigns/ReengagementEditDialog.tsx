import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSaveReengagement } from "@/hooks/useReengagement";
import { BODY_MAX, renderMessage, TITLE_MAX } from "@/lib/domain/campaigns";
import { DEFAULT_CONFIG, toForm, validateSequence, type ReengagementConfig, type ReengagementFormStep } from "@/lib/domain/reengagement";

interface Props { clinicId: string; config: ReengagementConfig; open: boolean; onOpenChange: (o: boolean) => void }

/** Edita as 3 mensagens e os dias da sequência. Liga/desliga fica no botão do cartão. */
export function ReengagementEditDialog({ clinicId, config, open, onOpenChange }: Props) {
  const [form, setForm] = useState<ReengagementFormStep[]>(toForm(config));
  const [sendChat, setSendChat] = useState(config.sendChat);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveReengagement(clinicId);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(toForm(config));
    setSendChat(config.sendChat);
  }, [open, config]);

  const patch = (i: number, p: Partial<ReengagementFormStep>) => setForm((f) => f.map((s, k) => (k === i ? { ...s, ...p } : s)));

  function submit() {
    const r = validateSequence(form);
    if (!r.ok) return setError(r.error);
    save.mutate(
      { isActive: config.isActive, sendChat, steps: r.value },
      { onSuccess: () => onOpenChange(false), onError: () => setError("Não foi possível salvar. Só o administrador da clínica edita a sequência.") },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar a sequência de reengajamento</DialogTitle>
          <DialogDescription>Use {"{nome}"} para o primeiro nome do paciente. Os dias contam desde a última interação dele.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {form.map((s, i) => (
            <fieldset key={i} className="space-y-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">Mensagem {i + 1}</legend>
              <div className="space-y-2">
                <Label htmlFor={`reeng-day-${i}`}>Dias sem interação</Label>
                <Input id={`reeng-day-${i}`} inputMode="numeric" className="w-28" value={s.day} onChange={(e) => patch(i, { day: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`reeng-title-${i}`}>Título</Label>
                <Input id={`reeng-title-${i}`} maxLength={TITLE_MAX} value={s.title} onChange={(e) => patch(i, { title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`reeng-body-${i}`}>Mensagem</Label>
                <Textarea id={`reeng-body-${i}`} rows={4} maxLength={BODY_MAX} value={s.body} onChange={(e) => patch(i, { body: e.target.value })} />
                <p className="text-xs text-muted-foreground">{s.body.length}/{BODY_MAX}</p>
              </div>
              <p className="text-xs text-muted-foreground">Como o paciente vê (exemplo com “Maria Souza”): <strong>{renderMessage(s.title, "Maria Souza")}</strong> — {renderMessage(s.body, "Maria Souza")}</p>
            </fieldset>
          ))}
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={sendChat} onChange={(e) => setSendChat(e.target.checked)} />
            <span>Enviar também como mensagem da equipe na conversa, para o paciente poder responder.</span>
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setForm(toForm(DEFAULT_CONFIG))}>Voltar aos textos padrão</Button>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
