// Peças compartilhadas das telas do módulo Financeiro/Estoque (Entrega 1): campo, select, checkbox, valor em R$,
// decimal, casca de tabela (rolagem só dentro dela), exportação e diálogo de formulário.
import * as React from "react";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { NavLink } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { centsToInput, parseBRL } from "@/lib/domain/finance";
import { parseDecimalBR } from "@/lib/domain/money";
import { CSV_MIME, downloadBlob, toCsv, toXlsx, XLSX_MIME, type ExportColumn } from "@/lib/domain/tableExport";
import { cn } from "@/lib/utils";

export function Field({ label, htmlFor, error, hint, className, children }: {
  label: string; htmlFor?: string; error?: string | null; hint?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn("flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)}
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
export function CentsInput({ id, value, onChange, placeholder = "0,00", disabled, "aria-label": ariaLabel }: {
  id?: string; value: number | null; onChange: (cents: number | null) => void; placeholder?: string; disabled?: boolean; "aria-label"?: string;
}) {
  const [text, setText] = useState(value === null ? "" : centsToInput(value));
  return (
    <Input
      id={id} aria-label={ariaLabel} inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled}
      onChange={(e) => { setText(e.target.value); onChange(e.target.value.trim() === "" ? null : parseBRL(e.target.value)); }}
    />
  );
}

/** Número decimal pt-BR (alíquota %, quantidade, fator). Vazio ou inválido = null. */
export function DecimalInput({ id, value, onChange, maxDecimals = 3, placeholder, disabled, "aria-label": ariaLabel, className }: {
  id?: string; value: number | null; onChange: (v: number | null) => void; maxDecimals?: number; placeholder?: string; disabled?: boolean; "aria-label"?: string; className?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value).replace(".", ","));
  return (
    <Input
      id={id} aria-label={ariaLabel} inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled} className={className}
      onChange={(e) => { setText(e.target.value); onChange(parseDecimalBR(e.target.value, maxDecimals)); }}
    />
  );
}

/** Tabela dentro de um quadro com rolagem horizontal PRÓPRIA — a página nunca ganha barra lateral. */
export function TableShell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[40rem] text-left text-sm" aria-label={label}>{children}</table>
    </div>
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
export function ExportButtons<T>({ columns, rows, filename, sheetName }: { columns: ExportColumn<T>[]; rows: T[]; filename: string; sheetName?: string }) {
  const disabled = rows.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Exportar tabela">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => downloadBlob(toCsv(columns, rows), `${filename}.csv`, CSV_MIME)}>
        <Download aria-hidden /> CSV
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => downloadBlob(toXlsx(columns, rows, sheetName ?? filename) as BlobPart, `${filename}.xlsx`, XLSX_MIME)}>
        <Download aria-hidden /> Excel
      </Button>
    </div>
  );
}

export function FormDialog({ open, onOpenChange, title, description, onSubmit, pending, error, submitLabel = "Salvar", wide, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; onSubmit: () => void; pending: boolean;
  error: string | null; submitLabel?: string; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (!pending ? onOpenChange(o) : undefined)}>
      <DialogContent className={cn("max-w-[calc(100vw-1.5rem)]", wide ? "sm:max-w-4xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form className="contents" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
          <DialogBody className="min-w-0 space-y-4">
            {children}
            {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {submitLabel}
            </Button>
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

/** Barra de abas por rota (rolagem horizontal própria no celular). */
export function SubNav({ items, label }: { items: { to: string; label: string; end?: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="min-w-0 max-w-full overflow-x-auto border-b">
      <ul className="flex w-max min-w-full gap-1">
        {items.map((i) => (
          <li key={i.to}>
            <NavLink
              to={i.to}
              end={i.end}
              className={({ isActive }) => cn("block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors", isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {i.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
