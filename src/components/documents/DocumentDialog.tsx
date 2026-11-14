// «Novo documento»: escolha do tipo → diálogo do provedor (demonstração) já preenchido → assinar → documento na timeline e na lista.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";

import { DemoBanner } from "@/components/documents/DemoBanner";
import { Field } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDocMutations } from "@/hooks/useClinicalDocs";
import { getDocument } from "@/lib/api/clinicalDocs";
import {
  DOC_TYPE_HINT, DOC_TYPE_LABEL, DOC_TYPES, docErrorMessage, EMPTY_ITEM, emptyDraft, formatCpf, isoDateBR, validateDraft,
  type DocDraft, type DocType, type DraftErrors, type PrescribedItem,
} from "@/lib/domain/clinicalDocs";
import { getPrescriptionProvider, type PrescriptionSession } from "@/lib/prescription";

export interface DocumentTarget { clinicId: string; patientId: string; patientName?: string; encounterId?: string | null; appointmentId?: string | null; providerId?: string | null }

function ItemsEditor({ type, items, onChange, error }: { type: DocType; items: PrescribedItem[]; onChange: (v: PrescribedItem[]) => void; error?: string }) {
  const set = (i: number, k: keyof PrescribedItem, v: string) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const receita = type === "receita";
  return (
    <fieldset className="min-w-0 space-y-3" aria-label={receita ? "Itens prescritos" : "Exames solicitados"}>
      <legend className="text-sm font-medium">{receita ? "Itens prescritos" : "Exames solicitados"}</legend>
      {items.map((it, i) => (
        <div key={i} className="min-w-0 space-y-2 rounded-md border p-3">
          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
            <Field label={receita ? "Medicamento" : "Exame"} htmlFor={`it-name-${i}`} className="sm:col-span-2">
              <Input id={`it-name-${i}`} value={it.name} maxLength={160} onChange={(e) => set(i, "name", e.target.value)} />
            </Field>
            {receita ? (
              <>
                <Field label="Dose" htmlFor={`it-dose-${i}`}><Input id={`it-dose-${i}`} value={it.dose} maxLength={80} onChange={(e) => set(i, "dose", e.target.value)} /></Field>
                <Field label="Quantidade" htmlFor={`it-qty-${i}`}><Input id={`it-qty-${i}`} value={it.quantity} maxLength={40} onChange={(e) => set(i, "quantity", e.target.value)} /></Field>
                <Field label="Posologia" htmlFor={`it-pos-${i}`} className="sm:col-span-2"><Input id={`it-pos-${i}`} value={it.posology} maxLength={200} onChange={(e) => set(i, "posology", e.target.value)} /></Field>
              </>
            ) : null}
          </div>
          {items.length > 1 || !receita ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /> Remover</Button>
          ) : null}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { ...EMPTY_ITEM }])}><Plus className="h-4 w-4" aria-hidden /> {receita ? "Adicionar medicamento" : "Adicionar exame"}</Button>
      {error ? <p className="text-xs font-medium text-destructive" role="alert">{error}</p> : null}
    </fieldset>
  );
}

function SessionForm({ session, onSigned, onClose }: { session: PrescriptionSession; onSigned: (id: string) => void; onClose: () => void }) {
  const provider = getPrescriptionProvider(session.provider);
  const [draft, setDraft] = useState<DocDraft>(() => ({ ...emptyDraft(session.type), cpf: session.patient.cpf ?? "", address: session.patient.address ?? "" }));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { refresh } = useDocMutations();
  const set = <K extends keyof DocDraft>(k: K, v: DocDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function sign() {
    const e = validateDraft(session.type, draft);
    setErrors(e);
    if (Object.keys(e).length > 0) { bodyRef.current?.querySelector<HTMLElement>("[role=alert]")?.scrollIntoView?.({ block: "center" }); return; }
    setServerError(null); setPending(true);
    try {
      const r = await provider.sign!(session, { title: draft.title, content: draft.content, items: draft.items, patientCpf: draft.cpf, patientAddress: draft.address });
      await refresh();
      onSigned(r.documentId);
    } catch (err) {
      setServerError(docErrorMessage(err));
    } finally { setPending(false); }
  }

  return (
    <form className="contents" noValidate onSubmit={(ev) => { ev.preventDefault(); void sign(); }}>
      <DialogBody className="min-w-0 space-y-4">
        <div ref={bodyRef} className="min-w-0 space-y-4">
          {session.isDemo ? <DemoBanner /> : null}
          <section aria-label="Dados preenchidos pelo provedor" className="grid min-w-0 gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Paciente</p><p className="break-words font-medium">{session.patient.name}</p><p className="text-xs text-muted-foreground">Nascimento {isoDateBR(session.patient.birthDate)}</p></div>
            <div className="min-w-0"><p className="text-xs text-muted-foreground">Profissional</p><p className="break-words font-medium">{session.professional.name}</p><p className="break-words text-xs text-muted-foreground">{[session.professional.registryNumber, session.professional.specialty].filter(Boolean).join(" · ")}</p></div>
            <div className="min-w-0 sm:col-span-2"><p className="text-xs text-muted-foreground">Clínica</p><p className="break-words font-medium">{session.clinic.name}</p></div>
          </section>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Field label="CPF do paciente (opcional)" htmlFor="doc-cpf" error={errors.cpf} hint="Os novos modelos de receita pedem o CPF.">
              <Input id="doc-cpf" inputMode="numeric" value={draft.cpf} placeholder="000.000.000-00" onChange={(e) => set("cpf", e.target.value)} onBlur={() => set("cpf", formatCpf(draft.cpf))} />
            </Field>
            <Field label="Endereço do paciente (opcional)" htmlFor="doc-address"><Input id="doc-address" value={draft.address} maxLength={240} onChange={(e) => set("address", e.target.value)} /></Field>
          </div>
          <Field label="Título" htmlFor="doc-title" error={errors.title}><Input id="doc-title" value={draft.title} maxLength={160} onChange={(e) => set("title", e.target.value)} /></Field>
          {session.type === "receita" || session.type === "exames" ? <ItemsEditor type={session.type} items={draft.items} onChange={(v) => set("items", v)} error={errors.items} /> : null}
          <Field label={session.type === "receita" ? "Orientações (opcional)" : session.type === "exames" ? "Observações (opcional)" : "Texto do documento"} htmlFor="doc-content" error={errors.content}>
            <Textarea id="doc-content" rows={session.type === "atestado" || session.type === "relatorio" ? 8 : 4} value={draft.content} maxLength={20000} onChange={(e) => set("content", e.target.value)} />
          </Field>
          {serverError ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{serverError}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter className="flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {session.isDemo ? "Assinar (demonstração)" : "Assinar"}</Button>
      </DialogFooter>
    </form>
  );
}

export function DocumentDialog({ target, initialType, onClose }: { target: DocumentTarget; initialType?: DocType; onClose: () => void }) {
  const [type, setType] = useState<DocType | null>(initialType ?? null);
  const [session, setSession] = useState<PrescriptionSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signedId, setSignedId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    if (!type) return;
    let alive = true;
    setSession(null); setLoadError(null);
    getPrescriptionProvider(target.providerId).openSession({ clinicId: target.clinicId, patientId: target.patientId, type, encounterId: target.encounterId, appointmentId: target.appointmentId })
      .then((s) => { if (alive) setSession(s); })
      .catch((e) => { if (alive) setLoadError(docErrorMessage(e)); });
    return () => { alive = false; };
  }, [type, target.clinicId, target.patientId, target.encounterId, target.appointmentId, target.providerId]);

  async function downloadPdf() {
    if (!signedId) return;
    setPdfBusy(true); setPdfError(null);
    try {
      const [doc, { downloadClinicalDocumentPdf }] = await Promise.all([getDocument(signedId), import("@/lib/pdf/generateClinicalDocumentPdf")]);
      await downloadClinicalDocumentPdf(doc);
    } catch (e) { setPdfError(docErrorMessage(e)); } finally { setPdfBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{type ? `${DOC_TYPE_LABEL[type]}${target.patientName ? ` — ${target.patientName}` : ""}` : "Novo documento"}</DialogTitle>
          <DialogDescription>{signedId ? "Documento assinado e guardado no prontuário." : type ? "Dados do paciente, do profissional e da clínica já vêm preenchidos." : "Escolha o tipo de documento."}</DialogDescription>
        </DialogHeader>
        {signedId ? (
          <>
            <DialogBody className="min-w-0 space-y-3">
              <p className="flex items-start gap-2 text-sm" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> Documento assinado{session?.isDemo ? " (demonstração, sem validade legal)" : ""}. Ele já aparece na linha do tempo e na aba Documentos do paciente.</p>
              {pdfError ? <p className="text-sm text-destructive" role="alert">{pdfError}</p> : null}
            </DialogBody>
            <DialogFooter className="flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void downloadPdf()} disabled={pdfBusy}>{pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Baixar PDF</Button>
              <Button type="button" onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </>
        ) : !type ? (
          <DialogBody className="min-w-0">
            <div className="grid gap-2 sm:grid-cols-2">
              {DOC_TYPES.map((t) => (
                <Button key={t} type="button" variant="outline" className="h-auto min-w-0 flex-col items-start gap-0.5 whitespace-normal py-3 text-left" onClick={() => setType(t)}>
                  <span className="font-medium">{DOC_TYPE_LABEL[t]}</span><span className="text-xs font-normal text-muted-foreground">{DOC_TYPE_HINT[t]}</span>
                </Button>
              ))}
            </div>
          </DialogBody>
        ) : loadError ? (
          <>
            <DialogBody className="min-w-0"><p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{loadError}</p></DialogBody>
            <DialogFooter className="flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { setType(null); setLoadError(null); }}>Voltar</Button><Button type="button" onClick={onClose}>Fechar</Button></DialogFooter>
          </>
        ) : !session ? (
          <DialogBody className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Abrindo o provedor…</DialogBody>
        ) : (
          <SessionForm key={session.sessionId} session={session} onSigned={setSignedId} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
