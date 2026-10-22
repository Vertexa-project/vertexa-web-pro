import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { executeAccountDeletion, listOpenDeletionRequests, removeStoredFiles, type DeletionRequest } from "@/lib/api/accountDeletion";

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" });

/** Pedidos de exclusão de conta feitos pelos pacientes (LGPD). Só o admin vê; some quando não há pedido. */
export function AccountDeletionCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["accountDeletionRequests"], queryFn: listOpenDeletionRequests });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async (r: DeletionRequest) => {
      const files = await executeAccountDeletion(r.id);
      const failed = await removeStoredFiles(r.id, files);
      return { name: r.patientName, failed };
    },
    onSuccess: ({ name, failed }) => {
      setConfirming(null);
      setMsg(failed === 0 ? `Conta de ${name} anonimizada. O histórico clínico foi mantido sem identificação.` : `Conta de ${name} anonimizada, mas ${failed} arquivo(s) não saíram do armazenamento; ficam registrados para nova tentativa.`);
      void qc.invalidateQueries({ queryKey: ["accountDeletionRequests"] });
    },
    onError: () => { setConfirming(null); setMsg("Não foi possível concluir a exclusão. Nada foi alterado; tente de novo."); },
  });

  const list = q.data ?? [];
  if (list.length === 0 && !msg) return null;
  return (
    <Card data-testid="account-deletion">
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-warning" aria-hidden /> Pedidos de exclusão de conta</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {msg && <p className="text-sm text-muted-foreground" role="status">{msg}</p>}
        {list.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{r.patientName}</p>
              <p className="text-xs text-muted-foreground">Pedido de {DATE.format(new Date(r.requestedAt))}. Ao excluir: nome, e-mail, nascimento, fotos e documentos são removidos e o acesso é bloqueado; peso, refeições e treinos ficam sem identificação.</p>
            </div>
            {confirming === r.id ? (
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" disabled={run.isPending} onClick={() => run.mutate(r)}>Confirmar exclusão</Button>
                <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => setConfirming(null)}>Voltar</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(r.id)}>Excluir conta</Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
