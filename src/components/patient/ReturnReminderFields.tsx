// Retorno e mensagem no cadastro do paciente (redesign P6, "Escolha das mensagens no cadastro do paciente").
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_MESSAGE_LENGTH, NOTICE_OPTIONS, renderReminderMessage, type ReturnReminderForm } from "@/lib/domain/patientReminders";
import { todayIsoBR } from "@/lib/domain/stockMoves";

export function ReturnReminderFields({ value, onChange, patientName }: { value: ReturnReminderForm; onChange: (v: ReturnReminderForm) => void; patientName: string }) {
  const set = <K extends keyof ReturnReminderForm>(k: K, v: ReturnReminderForm[K]) => onChange({ ...value, [k]: v });
  const preview = value.dueOn ? renderReminderMessage(value.message, { name: patientName, dueOn: value.dueOn, title: null, kind: "return", todayIso: todayIsoBR() }) : "";
  return (
    <section className="space-y-3" aria-labelledby="np-return-title">
      <div>
        <h3 id="np-return-title" className="text-sm font-semibold">Retorno e mensagens (opcional)</h3>
        <p className="text-xs text-muted-foreground">Com a data, o paciente é avisado no app e você vê no Hoje. Dá para mudar depois na ficha.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="np-return-date">Data do retorno</Label>
          <Input id="np-return-date" type="date" value={value.dueOn} onChange={(e) => set("dueOn", e.target.value)} />
        </div>
        {value.dueOn ? (
          <div className="space-y-1.5">
            <Label htmlFor="np-return-days">Quando avisar o paciente</Label>
            <Select value={String(value.days)} onValueChange={(v) => set("days", Number(v))}>
              <SelectTrigger id="np-return-days" className="w-full" disabled={!value.notify}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTICE_OPTIONS.map((o) => (
                  <SelectItem key={o.days} value={String(o.days)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {value.dueOn ? (
        <>
          <div className="flex items-center gap-2">
            <input id="np-return-notify" type="checkbox" className="h-4 w-4 accent-primary" checked={value.notify} onChange={(e) => set("notify", e.target.checked)} />
            <Label htmlFor="np-return-notify" className="font-normal">Avisar o paciente pelo app</Label>
          </div>
          {value.notify ? (
            <div className="space-y-1.5">
              <Label htmlFor="np-return-msg">Mensagem para o paciente</Label>
              <Textarea id="np-return-msg" rows={3} maxLength={MAX_MESSAGE_LENGTH} value={value.message} onChange={(e) => set("message", e.target.value)} />
              {preview ? <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">Como o paciente vê: {preview}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
