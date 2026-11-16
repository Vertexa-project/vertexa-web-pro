// Cadastrar exame ou retorno (A2, redesign P6): data, quando avisar e a mensagem do paciente (texto padrão editável).
// Mudou a data: a MESMA linha muda (sem duplicar). Quem recebe: o paciente no app e a equipe no Hoje.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSaveReminder } from "@/hooks/usePatientReminders";
import {
  DEFAULT_NOTICE_DAYS, DEFAULT_TEMPLATES, MAX_MESSAGE_LENGTH, NOTICE_OPTIONS, renderReminderMessage, TEMPLATE_TOKENS, validateReminderInput,
  type ReminderKind, type ReminderRow,
} from "@/lib/domain/patientReminders";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { isDisciplineDenied } from "@/lib/domain/disciplines";
import { captureException } from "@/lib/observability/sentry";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  kind: ReminderKind;
  /** Lembrete aberto para editar; null = novo. */
  existing: ReminderRow | null;
}

function NoticeSelect({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  const options = NOTICE_OPTIONS.some((o) => o.days === value) ? NOTICE_OPTIONS : [...NOTICE_OPTIONS, { days: value, label: `${value} dias antes` }].sort((a, b) => a.days - b.days);
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.days} value={String(o.days)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ReminderDialog({ open, onOpenChange, patientId, patientName, kind, existing }: Props) {
  const save = useSaveReminder(patientId);
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [notify, setNotify] = useState(true);
  const [days, setDays] = useState<number>(DEFAULT_NOTICE_DAYS[kind]);
  const [proDays, setProDays] = useState<number>(DEFAULT_NOTICE_DAYS[kind]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(existing?.title ?? "");
    setDueOn(existing?.due_on ?? "");
    setNotify(existing?.notify_patient ?? true);
    setDays(existing?.notify_days_before ?? DEFAULT_NOTICE_DAYS[kind]);
    setProDays(existing?.pro_notify_days_before ?? DEFAULT_NOTICE_DAYS[kind]);
    setMessage(existing?.message_template ?? DEFAULT_TEMPLATES[kind]);
    setError(null);
  }, [open, existing, kind]);

  const todayIso = todayIsoBR();
  const preview = useMemo(
    () => (dueOn ? renderReminderMessage(message, { name: patientName, dueOn, title: title || null, kind, todayIso }) : ""),
    [message, dueOn, title, kind, patientName, todayIso],
  );
  const isDefault = message.trim() === DEFAULT_TEMPLATES[kind];

  function handleSave() {
    const input = { kind, title, dueOn, noticeDays: days, proNoticeDays: proDays, message };
    const invalid = validateReminderInput(input, todayIso);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    save.mutate(
      { patientId, id: existing?.id ?? null, kind, title: title.trim(), dueOn, noticeDays: days, proNoticeDays: proDays, message: isDefault ? "" : message, notifyPatient: notify },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => {
          captureException(e, { source: "reminder", scope: kind });
          setError(isDisciplineDenied(e) ? "Só quem acompanha o paciente cadastra lembretes." : "Não foi possível salvar o lembrete. Tente novamente.");
        },
      },
    );
  }

  const label = kind === "return" ? "retorno" : "exame";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!save.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? `Editar ${label}` : kind === "return" ? "Cadastrar retorno" : "Cadastrar exame"}</DialogTitle>
          <DialogDescription>
            Cria o lembrete para o paciente (no app) e para você (no Hoje). Se a data mudar, o lembrete muda junto.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {kind === "exam" ? (
            <div className="space-y-2">
              <Label htmlFor="rem-title">Exame</Label>
              <Input id="rem-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Hemograma e ferritina" autoFocus />
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rem-date">{kind === "return" ? "Data do retorno" : "Fazer até"}</Label>
              <Input id="rem-date" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rem-pro">Avisar a equipe</Label>
              <NoticeSelect id="rem-pro" value={proDays} onChange={setProDays} />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <input id="rem-notify" type="checkbox" className="h-4 w-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <Label htmlFor="rem-notify" className="font-normal">Avisar o paciente pelo app</Label>
            </div>
            {notify ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rem-days">Quando avisar o paciente</Label>
                  <NoticeSelect id="rem-days" value={days} onChange={setDays} />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="rem-msg">Mensagem para o paciente</Label>
                    {!isDefault ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setMessage(DEFAULT_TEMPLATES[kind])}>
                        Voltar ao texto padrão
                      </Button>
                    ) : null}
                  </div>
                  <Textarea id="rem-msg" rows={3} value={message} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => setMessage(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Marcas que se preenchem sozinhas: {TEMPLATE_TOKENS.join(" ")}.</p>
                </div>
                {preview ? (
                  <div className="rounded-md border bg-background p-3 text-sm" aria-live="polite">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Como o paciente vê</p>
                    <p className="mt-1 text-foreground">{preview}</p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {save.isPending ? "Salvando…" : "Salvar lembrete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
