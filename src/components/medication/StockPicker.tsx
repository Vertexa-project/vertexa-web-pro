// Escolha do item de estoque para dar baixa (A3). "Sem baixa" = só registra. Saldo mostrado; o servidor bloqueia saldo insuficiente.
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMedStockOptions } from "@/hooks/useMedication";
import { NO_STOCK } from "@/lib/domain/medication";
import { formatQty } from "@/lib/domain/stockMoves";

export function StockPicker({ id, patientId, value, onChange, label, hint }: { id: string; patientId: string; value: string; onChange: (v: string) => void; label: string; hint?: string }) {
  const q = useMedStockOptions(patientId, true);
  const options = q.data ?? [];
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={q.isLoading}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_STOCK}>Sem baixa de estoque (só registrar)</SelectItem>
          {options.map((o) => (
            <SelectItem key={`${o.item_id}|${o.unit_id}`} value={`${o.item_id}|${o.unit_id}`}>
              {o.item_name} · {o.unit_name} (saldo {formatQty(o.qty_on_hand)})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {q.isError ? <p className="text-xs text-muted-foreground">Não foi possível carregar o estoque. Você ainda pode só registrar.</p> : null}
      {!q.isError && !q.isLoading && options.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum medicamento com saldo cadastrado no Estoque.</p> : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
