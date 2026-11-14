// «Como foi calculado»: a memória gravada na linha de repasse (regra aplicada, base, percentual, deduções), para o profissional e o gestor auditarem.
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PayoutLineRow } from "@/lib/api/finPayout";
import { formatBRL } from "@/lib/domain/finance";
import { describeMemory, PAYOUT_LINE_LABEL } from "@/lib/domain/finPayout";

export function PayoutMemoryDialog({ line, onClose }: { line: PayoutLineRow; onClose: () => void }) {
  const view = describeMemory(line.memory, line.line_type);
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Como foi calculado</DialogTitle>
          <DialogDescription>{PAYOUT_LINE_LABEL[line.line_type]} · {line.professional_name} · {formatBRL(line.amount_cents)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-w-0 space-y-3">
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {line.base_cents !== null ? <div><dt className="text-xs text-muted-foreground">Base de cálculo</dt><dd className="tabular-nums">{formatBRL(line.base_cents)}</dd></div> : null}
            {line.pct !== null ? <div><dt className="text-xs text-muted-foreground">Percentual</dt><dd className="tabular-nums">{String(line.pct).replace(".", ",")}%</dd></div> : null}
            <div><dt className="text-xs text-muted-foreground">Valor do repasse</dt><dd className="font-medium tabular-nums">{formatBRL(line.amount_cents)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Extrato</dt><dd>{line.period.slice(5)}/{line.period.slice(0, 4)}</dd></div>
            {view.rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>)}
          </dl>
          {view.formula ? <p className="rounded-md bg-muted/50 px-3 py-2 text-sm"><span className="font-medium">Conta: </span>{view.formula}</p> : null}
          {view.correction ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">{view.correction}</p> : null}
        </DialogBody>
        <DialogFooter><Button onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
