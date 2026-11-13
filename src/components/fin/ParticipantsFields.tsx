// Participantes do atendimento (escopo-v1 §4.1/§4.4): responsável (obrigatório), executor e auxiliares — a entrada do motor de repasse da Entrega 5.
import { Plus, Trash2 } from "lucide-react";

import { Field, NativeSelect } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import type { ApptRole, ParticipantsValue } from "@/lib/domain/finAppointments";

export function ParticipantsFields({ idPrefix, value, onChange, professionals, allowedRoles, error }: {
  idPrefix: string; value: ParticipantsValue; onChange: (v: ParticipantsValue) => void; professionals: { id: string; name: string }[]; allowedRoles: ApptRole[]; error?: string | null;
}) {
  const opts = professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>);
  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Quem participou</legend>
      <Field label="Responsável" htmlFor={`${idPrefix}-resp`} error={error}>
        <NativeSelect id={`${idPrefix}-resp`} value={value.responsavel} onChange={(e) => onChange({ ...value, responsavel: e.target.value })}>
          <option value="">Selecione…</option>{opts}
        </NativeSelect>
      </Field>
      {allowedRoles.includes("executor") ? (
        <Field label="Executor" htmlFor={`${idPrefix}-exec`} hint="Quem aplicou/realizou, quando é outra pessoa. Confirma o kit.">
          <NativeSelect id={`${idPrefix}-exec`} value={value.executor} onChange={(e) => onChange({ ...value, executor: e.target.value })}>
            <option value="">Sem executor separado</option>{opts}
          </NativeSelect>
        </Field>
      ) : null}
      {allowedRoles.includes("auxiliar") ? (
        <div className="space-y-2">
          {value.auxiliares.map((a, i) => (
            <div key={i} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <Field label={`Auxiliar ${i + 1}`} htmlFor={`${idPrefix}-aux-${i}`}>
                <NativeSelect id={`${idPrefix}-aux-${i}`} value={a} onChange={(e) => onChange({ ...value, auxiliares: value.auxiliares.map((x, j) => (j === i ? e.target.value : x)) })}>
                  <option value="">Selecione…</option>{opts}
                </NativeSelect>
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover auxiliar ${i + 1}`} onClick={() => onChange({ ...value, auxiliares: value.auxiliares.filter((_, j) => j !== i) })}><Trash2 aria-hidden /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, auxiliares: [...value.auxiliares, ""] })}><Plus aria-hidden /> Adicionar auxiliar</Button>
        </div>
      ) : null}
    </fieldset>
  );
}
