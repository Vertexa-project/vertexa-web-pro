// Peças compartilhadas das telas do módulo Financeiro/Estoque (Entrega 1): campo, select, checkbox, valor em R$,
// decimal, casca de tabela (rolagem só dentro dela), exportação e diálogo de formulário.
import * as React from "react";
import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { NavLink } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { centsToInput, parseBRL } from "@/lib/domain/finance";
import { parseDecimalBR } from "@/lib/domain/money";
import { useFocusFirstError, useNarrow } from "@/components/fin/useFinUi";
import { MONTH_NAMES } from "@/lib/domain/taxRate";
import { CSV_MIME, downloadBlob, toCsv, toXlsx, XLSX_MIME, type ExportColumn } from "@/lib/domain/tableExport";
import { cn } from "@/lib/utils";

export function Field({ label, htmlFor, error, hint, className, children }: {
  label: string; htmlFor?: string; error?: string | null; hint?: string; className?: string; children: React.ReactNode;
}) {
  const errId = htmlFor ? `${htmlFor}-err` : undefined;
  // O controle com erro ganha aria-invalid: é por ele que o diálogo rola e foca o primeiro campo com problema.
  const control = error && React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, { "aria-invalid": true, "aria-describedby": errId })
    : children;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {control}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={errId} className="text-xs font-medium text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn("flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive", className)}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";

export function CheckField({ id, label, checked, onChange, disabled, hint }: {
  id: string; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={cn("flex items-start gap-2 text-sm", disabled && "opacity-70")}>
        <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(24_95%_53%)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint ? <p className="ml-6 mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Valor em R$ (guarda CENTAVOS). Vazio ou inválido = null. */
export function CentsInput({ id, value, onChange, placeholder = "0,00", disabled, "aria-label": ariaLabel, ...aria }: {
  id?: string; value: number | null; onChange: (cents: number | null) => void; placeholder?: string; disabled?: boolean; "aria-label"?: string;
  "aria-invalid"?: boolean; "aria-describedby"?: string;
}) {
  const [text, setText] = useState(value === null ? "" : centsToInput(value));
  return (
    <Input
      id={id} aria-label={ariaLabel} inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled} {...aria}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() === "" ? null : parseBRL(e.target.value)); }}
    />
  );
}

/** Número decimal pt-BR (alíquota %, quantidade, fator). Vazio ou inválido = null. */
export function DecimalInput({ id, value, onChange, maxDecimals = 3, placeholder, disabled, "aria-label": ariaLabel, className, ...aria }: {
  id?: string; value: number | null; onChange: (v: number | null) => void; maxDecimals?: number; placeholder?: string; disabled?: boolean; "aria-label"?: string; className?: string;
  "aria-invalid"?: boolean; "aria-describedby"?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value).replace(".", ","));
  return (
    <Input
      id={id} aria-label={ariaLabel} inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled} className={className} {...aria}
      onChange={(e) => { setText(e.target.value); onChange(parseDecimalBR(e.target.value, maxDecimals)); }}
    />
  );
}

/** Competência (AAAA-MM) por mês em português + ano — o `input type=month` do navegador aparece em inglês. */
export function MonthYearPicker({ id, value, onChange, disabled }: { id: string; value: string; onChange: (period: string) => void; disabled?: boolean }) {
  const [y, m] = value.split("-");
  const thisYear = new Date().getFullYear();
  const year = Number(y) || thisYear;
  const years = Array.from(new Set([thisYear - 3, thisYear - 2, thisYear - 1, thisYear, thisYear + 1, thisYear + 2, year])).sort((a, b) => a - b);
  const month = Number(m) || 1;
  const emit = (yy: number, mm: number) => onChange(`${yy}-${String(mm).padStart(2, "0")}`);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(5.5rem,6.5rem)] gap-2">
      <NativeSelect id={id} aria-label="Mês da competência" value={month} disabled={disabled} onChange={(e) => emit(year, Number(e.target.value))}>
        {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n.charAt(0).toUpperCase() + n.slice(1)}</option>)}
      </NativeSelect>
      <NativeSelect id={`${id}-ano`} aria-label="Ano da competência" value={year} disabled={disabled} onChange={(e) => emit(Number(e.target.value), month)}>
        {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
      </NativeSelect>
    </div>
  );
}

/** Tabela dentro de um quadro com rolagem horizontal PRÓPRIA — a página nunca ganha barra lateral. */
export function TableShell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-left text-sm" aria-label={label}>{children}</table>
    </div>
  );
}

export type FinColumnRole = "title" | "badge" | "field" | "action";
export interface FinColumn<T> { header: string; cell: (row: T) => React.ReactNode; role?: FinColumnRole; nowrap?: boolean; className?: string; /** classe do cabeçalho (ex.: text-right sobre coluna de valores) */ headClassName?: string; /** no cartão do celular, ocupa a linha inteira */ wide?: boolean }

/**
 * Lista do módulo: tabela no computador; em telas < 640 px, um cartão por linha (nome, dados principais e o botão
 * Editar/Ver sempre à vista). Renderiza só uma das duas formas.
 */
export function FinTable<T>({ label, rows, rowKey, columns }: { label: string; rows: T[]; rowKey: (row: T) => string; columns: FinColumn<T>[] }) {
  const narrow = useNarrow();
  if (!narrow) {
    return (
      <TableShell label={label}>
        <thead><tr>{columns.map((c) => <Th key={c.header} className={c.headClassName}>{c.header === "Ações" ? <span>Ações</span> : c.header}</Th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="align-top">
              {columns.map((c) => <Td key={c.header} className={cn(c.role === "title" && "font-medium", c.nowrap && "whitespace-nowrap", c.className)}>{c.cell(r)}</Td>)}
            </tr>
          ))}
        </tbody>
      </TableShell>
    );
  }
  const title = columns.find((c) => c.role === "title") ?? columns[0];
  const badges = columns.filter((c) => c.role === "badge");
  const actions = columns.filter((c) => c.role === "action");
  const fields = columns.filter((c) => c !== title && !badges.includes(c) && !actions.includes(c));
  return (
    <ul aria-label={label} className="min-w-0 space-y-3">
      {rows.map((r) => (
        <li key={rowKey(r)} className="min-w-0 space-y-2 rounded-lg border bg-card p-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0 break-words font-medium">{title.cell(r)}</div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">{badges.map((b) => <span key={b.header}>{b.cell(r)}</span>)}</div>
          </div>
          {fields.length > 0 ? (
            <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {fields.map((f) => (
                <div key={f.header} className={cn("min-w-0", f.wide && "col-span-2")}>
                  <dt className="text-xs text-muted-foreground">{f.header}</dt>
                  <dd className="min-w-0 break-words tabular-nums">{f.cell(r)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {actions.length > 0 ? <div className="flex flex-wrap gap-2 pt-1">{actions.map((a) => <span key={a.header}>{a.cell(r)}</span>)}</div> : null}
        </li>
      ))}
    </ul>
  );
}
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th scope="col" className={cn("whitespace-nowrap border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}>{children}</th>
);
export const Td = ({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cn("border-b px-3 py-2 align-middle", className)}>{children}</td>
);

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "muted"}>{active ? "Ativo" : "Inativo"}</Badge>;
}

/** CSV e Excel da tabela exibida (toda tabela nova do módulo). */
export function ExportButtons<T>({ columns, rows, filename, sheetName, label }: { columns: ExportColumn<T>[]; rows: T[]; filename: string; sheetName?: string; label?: string }) {
  const disabled = rows.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label ?? "Exportar tabela"}>
      {label ? <span className="text-sm font-medium text-muted-foreground">{label}:</span> : null}
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => downloadBlob(toCsv(columns, rows), `${filename}.csv`, CSV_MIME)}>
        <Download aria-hidden /> CSV
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => downloadBlob(toXlsx(columns, rows, sheetName ?? filename) as BlobPart, `${filename}.xlsx`, XLSX_MIME)}>
        <Download aria-hidden /> Excel
      </Button>
    </div>
  );
}

export function FormDialog({ open, onOpenChange, title, description, onSubmit, pending, error, submitLabel = "Salvar", wide, readOnly, attempt, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; onSubmit: () => void; pending: boolean;
  error: string | null; submitLabel?: string; wide?: boolean; readOnly?: boolean; attempt?: number; children: React.ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tries, setTries] = useState(0);
  useFocusFirstError(bodyRef, tries > 0 ? `${tries}|${attempt ?? 0}|${error ?? ""}` : null);
  return (
    <Dialog open={open} onOpenChange={(o) => (!pending ? onOpenChange(o) : undefined)}>
      <DialogContent className={cn("max-w-[calc(100vw-1.5rem)]", wide ? "sm:max-w-4xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form className="contents" noValidate onSubmit={(e) => { e.preventDefault(); if (readOnly) return; setTries((n) => n + 1); onSubmit(); }}>
          <DialogBody className="min-w-0 space-y-4">
            <div ref={bodyRef} className="min-w-0 space-y-4">
              {children}
              {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
            </div>
          </DialogBody>
          <DialogFooter>
            {readOnly ? (
              <Button type="button" onClick={() => onOpenChange(false)}>Fechar</Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
                <Button type="submit" disabled={pending} aria-busy={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  {submitLabel}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Motivo (obrigatório ao desativar; opcional nas demais mudanças) — vai para o histórico. */
export function ReasonField({ value, onChange, required, error }: { value: string; onChange: (v: string) => void; required: boolean; error?: string | null }) {
  return (
    <Field label={required ? "Motivo da desativação" : "Motivo da alteração (opcional)"} htmlFor="fin-reason" error={error} hint="Fica registrado no Histórico, com quem fez e quando.">
      <Input id="fin-reason" value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} />
    </Field>
  );
}

/** Barra de abas por rota: quebra de linha no celular (sem barra rolando de lado). */
export function SubNav({ items, label }: { items: { to: string; label: string; end?: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="min-w-0 max-w-full border-b">
      <ul className="flex min-w-0 flex-wrap gap-x-1">
        {items.map((i) => (
          <li key={i.to} className="min-w-0">
            <NavLink
              to={i.to}
              end={i.end}
              className={({ isActive }) => cn("block border-b-2 px-3 py-2 text-sm font-medium transition-colors", isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
