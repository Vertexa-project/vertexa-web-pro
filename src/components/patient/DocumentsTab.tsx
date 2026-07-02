import { useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Upload } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { usePatientDocuments } from "@/hooks/useBodyAssessments";
import { usePatientExams, useUploadPatientDocument } from "@/hooks/useDocuments";
import {
  ALLOWED_DOCUMENT_MIME,
  getDocumentSignedUrl,
  MAX_DOCUMENT_SIZE_BYTES,
} from "@/lib/api/documents";
import { formatDate, formatFileSize } from "@/lib/domain/format";
import { isSafeDocumentUrl } from "@/lib/domain/safeUrl";
import type { PatientDocumentKind, PatientDocumentView } from "@/types/db";

const KIND_LABELS: Record<PatientDocumentKind, string> = {
  exam: "Exame",
  report: "Relatório",
  other: "Outro",
};

const ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

const METHOD_LABELS: Record<string, string> = {
  bioimpedancia: "Bioimpedância",
  adipometro: "Adipômetro",
  dobras: "Dobras cutâneas",
  circunferencias: "Circunferências",
  dexa: "DEXA",
  manual: "Manual",
};

function laudoTitle(method: string | null): string {
  if (!method) return "Documento";
  return `Laudo · ${METHOD_LABELS[method] ?? method}`;
}

function uploaderLabel(doc: PatientDocumentView): string {
  if (doc.uploaded_by_name) return doc.uploaded_by_name;
  return doc.uploaded_by_role === "patient" ? "Paciente" : "Profissional";
}

/**
 * Aba Documentos do prontuário. Duas seções:
 *  1) EXAMES E DOCUMENTOS (patient_documents): upload real pela web para bucket PRIVADO +
 *     lista com "quem enviou · data · tamanho" e "Abrir" que gera a URL assinada NO CLIQUE.
 *  2) LAUDOS DAS AVALIAÇÕES (body_assessments.document_url): legado, SOMENTE LEITURA — nada some.
 *     URL crua sob allowlist de esquema (isSafeDocumentUrl, dívida #18 até tudo virar signed URL).
 */
export function DocumentsTab({ patientId }: { patientId: string }) {
  const exams = usePatientExams(patientId);
  const legacy = usePatientDocuments(patientId);
  const upload = useUploadPatientDocument(patientId);
  const { data: professional } = useCurrentProfessional();

  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PatientDocumentKind>("exam");
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  function triggerPick() {
    setNotice(null);
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reenviar o mesmo arquivo
    if (!file) return;

    // Validação client (espelha a api/) para mensagem amigável — a barreira real é o servidor.
    if (!(ALLOWED_DOCUMENT_MIME as readonly string[]).includes(file.type)) {
      setNotice({ tone: "error", text: "Formato não suportado. Envie PDF, JPG, PNG ou WEBP." });
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      setNotice({ tone: "error", text: "Arquivo muito grande. O limite é 15 MB." });
      return;
    }
    // Não persistir um documento de profissional sem o id de quem enviou (auditoria "quem enviou").
    if (!professional?.id) {
      setNotice({ tone: "error", text: "Perfil do profissional ainda não carregou. Tente novamente em instantes." });
      return;
    }

    try {
      await upload.mutateAsync({
        file,
        kind,
        title: file.name,
        uploadedByRole: "professional",
        uploadedByProfessionalId: professional.id,
      });
      setNotice({ tone: "success", text: "Documento enviado." });
    } catch {
      setNotice({ tone: "error", text: "Falha ao enviar o documento. Tente novamente." });
    }
  }

  // Abre o documento via URL assinada. Abre a aba ANTES do await (senão o pop-up blocker
  // bloqueia a janela aberta após uma promise). Fecha a aba se a assinatura falhar.
  async function openDocument(doc: PatientDocumentView) {
    setNotice(null);
    setOpeningId(doc.id);
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null; // mitiga reverse tabnabbing
    try {
      const url = await getDocumentSignedUrl(doc.file_path);
      if (win) win.location.href = url;
      else window.location.href = url; // fallback se o pop-up foi bloqueado
    } catch {
      if (win) win.close();
      setNotice({ tone: "error", text: "Não foi possível abrir o documento. Tente novamente." });
    } finally {
      setOpeningId(null);
    }
  }

  const isUploading = upload.isPending;

  return (
    <div className="space-y-8">
      {/* ── Seção 1: exames/documentos reais (upload + bucket privado + signed URL) ── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Exames e documentos</h3>
            <p className="text-xs text-muted-foreground">
              PDF ou imagem (até 15 MB). Armazenamento privado; o link é gerado ao abrir.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="doc-kind" className="text-xs text-muted-foreground">
                Tipo
              </Label>
              <Select value={kind} onValueChange={(v) => setKind(v as PatientDocumentKind)}>
                <SelectTrigger id="doc-kind" className="h-9 w-36" disabled={isUploading}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as PatientDocumentKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={triggerPick}
              disabled={isUploading || !professional?.id}
              title={!professional?.id ? "Carregando perfil do profissional…" : undefined}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {isUploading ? "Enviando…" : "Enviar documento"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={handleFile}
            />
          </div>
        </div>

        {/* Região viva SEMPRE montada (só o texto muda) — senão o leitor de tela pode não
            anunciar a mensagem inserida junto com o container. */}
        <p
          className={`min-h-[1.25rem] text-sm ${notice?.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
          aria-live="polite"
        >
          {notice?.text ?? ""}
        </p>

        <AsyncSection
          isLoading={exams.isLoading}
          isError={exams.isError}
          // Não pisca "vazio" durante o refetch pós-upload (mantém a lista até a nova chegar).
          isEmpty={!exams.isFetching && (!exams.data || exams.data.length === 0)}
          onRetry={() => exams.refetch()}
          emptyIcon={FileText}
          emptyTitle="Nenhum exame enviado"
          emptyDescription="Envie um PDF ou imagem de exame/laudo. Ficará disponível para toda a equipe."
        >
          <div className="space-y-3">
            {(exams.data ?? []).map((doc) => (
              <Card key={doc.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0 gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                      aria-hidden
                    >
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <CardTitle className="truncate text-base">
                          {doc.title?.trim() || KIND_LABELS[doc.kind as PatientDocumentKind] || "Documento"}
                        </CardTitle>
                        <Badge tone="muted" className="shrink-0">
                          {KIND_LABELS[doc.kind as PatientDocumentKind] ?? doc.kind}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {uploaderLabel(doc)} · {formatDate(doc.uploaded_at)} ·{" "}
                        {formatFileSize(doc.file_size_bytes)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => openDocument(doc)}
                    disabled={openingId === doc.id}
                  >
                    {openingId === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    Abrir
                  </Button>
                </CardHeader>
              </Card>
            ))}
          </div>
        </AsyncSection>
      </section>

      {/* ── Seção 2: LEGADO — laudos anexados às avaliações (body_assessments), SÓ LEITURA ── */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Laudos das avaliações</h3>
          <p className="text-xs text-muted-foreground">
            Arquivos anexados às avaliações corporais (DEXA, bioimpedância). Somente leitura.
          </p>
        </div>

        <AsyncSection
          isLoading={legacy.isLoading}
          isError={legacy.isError}
          isEmpty={!legacy.data || legacy.data.length === 0}
          onRetry={() => legacy.refetch()}
          emptyIcon={FileText}
          emptyTitle="Sem laudos anexados"
          emptyDescription="Laudos anexados às avaliações do paciente aparecerão aqui."
        >
          <div className="space-y-3">
            {(legacy.data ?? []).map((doc) => (
              <Card key={doc.id}>
                <CardHeader className="flex-row items-center justify-between space-y-0 gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                      aria-hidden
                    >
                      <FileText className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{laudoTitle(doc.method)}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {doc.assessed_at ? formatDate(doc.assessed_at) : "Sem data"}
                      </p>
                    </div>
                  </div>
                  {isSafeDocumentUrl(doc.document_url) ? (
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <a href={doc.document_url!} target="_blank" rel="noopener noreferrer">
                        Abrir documento
                      </a>
                    </Button>
                  ) : (
                    // Esquema fora da allowlist → não viramos um link clicável (XSS/phishing).
                    <span className="shrink-0 text-xs text-muted-foreground">Documento indisponível</span>
                  )}
                </CardHeader>
                {doc.body_fat_pct != null || doc.weight != null ? (
                  <CardContent className="flex gap-6 pt-0 text-sm text-muted-foreground">
                    {doc.weight != null ? <span>Peso: {doc.weight} kg</span> : null}
                    {doc.body_fat_pct != null ? <span>% Gordura: {doc.body_fat_pct}%</span> : null}
                  </CardContent>
                ) : null}
              </Card>
            ))}
          </div>
        </AsyncSection>
      </section>
    </div>
  );
}
