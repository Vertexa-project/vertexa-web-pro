import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileDown, History, Loader2, Send, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { clinicalKeys, useAgreementSends, useVersions } from "@/hooks/useClinical";
import { addAddendum, clinicalErrorMessage, type Encounter, type EncounterPeople, purgeAudio, sendAgreements } from "@/lib/api/clinical";
import { agreementsDraft } from "@/lib/clinical/agreements";
import { formatDateTimeBr } from "@/lib/clinical/display";
import { buildEncounterPdfData } from "@/lib/clinical/pdfModel";
import type { RecordFields } from "../../../supabase/functions/_shared/clinical/record";

interface Props {
  encounter: Encounter;
  fields: RecordFields;
  people: EncounterPeople | null | undefined;
  patientName: string;
  clinicName: string;
}

export function FinalizedActions({ encounter, fields, people, patientName, clinicName }: Props) {
  const qc = useQueryClient();
  const sends = useAgreementSends(encounter.id);
  const [showHistory, setShowHistory] = useState(false);
  const versions = useVersions(encounter.id, showHistory);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendText, setSendText] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [addendum, setAddendum] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);

  async function exportPdf() {
    setPdfBusy(true);
    setMsg(null);
    try {
      const { downloadEncounterReport } = await import("@/lib/pdf/generateEncounterReport");
      const addenda = people?.addenda ?? [];
      await downloadEncounterReport(
        buildEncounterPdfData({
          patientName,
          clinicName,
          sections: encounter.template_snapshot.sections,
          fields,
          people,
          startedAt: encounter.started_at,
          finalizedAt: encounter.finalized_at,
          demo: encounter.is_demo,
          addenda,
        }),
        encounter.started_at,
      );
    } catch {
      setMsg({ kind: "err", text: "Não foi possível gerar o PDF. Tente novamente." });
    } finally {
      setPdfBusy(false);
    }
  }

  async function doSend() {
    setSendBusy(true);
    setMsg(null);
    try {
      await sendAgreements(encounter.id, sendText);
      setSendOpen(false);
      setMsg({ kind: "ok", text: "Combinados enviados ao app do paciente." });
      await Promise.all([
        qc.invalidateQueries({ queryKey: clinicalKeys.sends(encounter.id) }),
        qc.invalidateQueries({ queryKey: clinicalKeys.encounter(encounter.id) }),
      ]);
    } catch (e) {
      setMsg({ kind: "err", text: clinicalErrorMessage(e) });
    } finally {
      setSendBusy(false);
    }
  }

  async function doAddendum() {
    setAddBusy(true);
    setMsg(null);
    try {
      await addAddendum(encounter.id, addendum);
      setAddendum("");
      await qc.invalidateQueries({ queryKey: clinicalKeys.all(encounter.id) });
      await qc.invalidateQueries({ queryKey: clinicalKeys.people(encounter.id) });
      setMsg({ kind: "ok", text: "Adendo registrado." });
    } catch (e) {
      setMsg({ kind: "err", text: clinicalErrorMessage(e) });
    } finally {
      setAddBusy(false);
    }
  }

  async function doPurge() {
    setPurgeBusy(true);
    try {
      await purgeAudio({ encounter_id: encounter.id, now: true });
      await qc.invalidateQueries({ queryKey: clinicalKeys.encounter(encounter.id) });
      setMsg({ kind: "ok", text: "Áudio apagado. A transcrição e o prontuário foram mantidos." });
    } catch {
      setMsg({ kind: "err", text: "Não foi possível apagar o áudio agora." });
    } finally {
      setPurgeBusy(false);
    }
  }

  const lastSend = sends.data?.[0];
  const addenda = people?.addenda ?? [];

  return (
    <Card data-testid="finalized-actions">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Atendimento finalizado <Badge tone="success">Finalizado em {encounter.finalized_at ? formatDateTimeBr(encounter.finalized_at) : "—"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">O prontuário não pode mais ser editado. Correções entram como adendo, com autor e data.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportPdf()} disabled={pdfBusy}>
            {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />} Exportar PDF
          </Button>
          <Button
            onClick={() => {
              setSendText(lastSend?.text ?? agreementsDraft(fields));
              setSendOpen(true);
            }}
          >
            <Send className="h-4 w-4" aria-hidden /> {lastSend ? "Reenviar combinados ao paciente" : "Enviar combinados ao paciente"}
          </Button>
          <Button variant="ghost" onClick={() => setShowHistory((v) => !v)}>
            <History className="h-4 w-4" aria-hidden /> {showHistory ? "Ocultar histórico" : "Histórico de alterações"}
          </Button>
        </div>
        {lastSend ? (
          <p className="text-sm text-success" data-testid="agreements-sent">
            Combinados enviados ao paciente em {formatDateTimeBr(lastSend.sent_at)}.
          </p>
        ) : null}
        {msg ? (
          <p role={msg.kind === "err" ? "alert" : "status"} className={msg.kind === "err" ? "text-sm text-destructive" : "text-sm text-success"}>
            {msg.text}
          </p>
        ) : null}

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Adendos</h3>
          {addenda.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum adendo.</p> : null}
          {addenda.map((a) => (
            <div key={a.id} className="rounded-md bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">
                {a.author ?? "—"} · {formatDateTimeBr(a.created_at)}
              </p>
              <p className="whitespace-pre-wrap break-words">{a.text}</p>
            </div>
          ))}
          <Textarea value={addendum} onChange={(e) => setAddendum(e.target.value)} placeholder="Escreva o adendo (correção ou complemento)" rows={3} aria-label="Texto do adendo" />
          <Button variant="outline" size="sm" onClick={() => void doAddendum()} disabled={addBusy || addendum.trim() === ""}>
            {addBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Registrar adendo
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
          {encounter.audio_deleted_at ? (
            <span className="text-muted-foreground">Áudio apagado em {formatDateTimeBr(encounter.audio_deleted_at)}.</span>
          ) : (
            <>
              <span className="text-muted-foreground">
                O áudio é apagado automaticamente em {encounter.audio_delete_after ? formatDateTimeBr(encounter.audio_delete_after) : "30 dias"}.
              </span>
              <Button variant="ghost" size="sm" onClick={() => void doPurge()} disabled={purgeBusy}>
                <Trash2 className="h-4 w-4" aria-hidden /> Apagar o áudio agora
              </Button>
            </>
          )}
        </div>

        {showHistory ? (
          <div className="space-y-2 border-t pt-4" data-testid="history">
            {versions.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
            {(versions.data ?? []).map((v) => (
              <div key={v.id} className="rounded-md border p-2 text-xs">
                <p className="font-medium">
                  {v.actor_name ?? "Sistema"} · {formatDateTimeBr(v.created_at)} · {ACTION_LABEL[v.action]}
                  {v.field_key ? ` · ${v.field_key}` : ""}
                </p>
                {v.field_key ? (
                  <p className="break-words text-muted-foreground">
                    Antes: {v.before_value?.value || "—"} → Depois: {v.after_value?.value || "—"}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar combinados ao paciente</DialogTitle>
            <DialogDescription>O texto abaixo chega como notificação no app do paciente. Revise antes de enviar.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Textarea value={sendText} onChange={(e) => setSendText(e.target.value)} rows={8} aria-label="Texto dos combinados" />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void doSend()} disabled={sendBusy || sendText.trim() === ""}>
              {sendBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const ACTION_LABEL = {
  ai: "IA preencheu",
  manual: "edição manual",
  unlock: "devolvido para a IA",
  finalize: "finalizado",
  addendum: "adendo",
  consent: "aceite registrado",
  status: "status",
} as const;
