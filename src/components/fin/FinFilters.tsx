import { Field, NativeSelect } from "@/components/fin/FinUi";
import { Input } from "@/components/ui/input";

/** Filtros comuns das listas da Entrega 2: período, unidade e situação. Quebram em 2 colunas no celular (sem rolagem lateral). */
export function FilterBar({ idPrefix, from, to, onFrom, onTo, units, unitId, onUnit, statuses, status, onStatus }: {
  idPrefix: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  units?: { id: string; name: string }[]; unitId?: string; onUnit?: (v: string) => void;
  statuses?: { value: string; label: string }[]; status?: string; onStatus?: (v: string) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4" role="search" aria-label="Filtros">
      <Field label="De" htmlFor={`${idPrefix}-from`}><Input id={`${idPrefix}-from`} type="date" value={from} onChange={(e) => onFrom(e.target.value)} /></Field>
      <Field label="Até" htmlFor={`${idPrefix}-to`}><Input id={`${idPrefix}-to`} type="date" value={to} onChange={(e) => onTo(e.target.value)} /></Field>
      {units && onUnit ? (
        <Field label="Unidade" htmlFor={`${idPrefix}-unit`}>
          <NativeSelect id={`${idPrefix}-unit`} value={unitId ?? ""} onChange={(e) => onUnit(e.target.value)}>
            <option value="">Todas</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
      ) : null}
      {statuses && onStatus ? (
        <Field label="Situação" htmlFor={`${idPrefix}-status`}>
          <NativeSelect id={`${idPrefix}-status`} value={status ?? ""} onChange={(e) => onStatus(e.target.value)}>
            <option value="">Todas</option>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </NativeSelect>
        </Field>
      ) : null}
    </div>
  );
}
