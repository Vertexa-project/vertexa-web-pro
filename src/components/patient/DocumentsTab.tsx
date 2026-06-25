import { useState } from "react";
import { FileText, Upload } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePatientDocuments } from "@/hooks/useBodyAssessments";
import { formatDate } from "@/lib/domain/format";
import { isSafeDocumentUrl } from "@/lib/domain/safeUrl";

const METHOD_LABELS: Record<string, string> = {
  bioimpedancia: "Bioimpedância",
  adipometro: "Adipômetro",
  dobras: "Dobras cutâneas",
  circunferencias: "Circunferências",
  dexa: "DEXA",
  manual: "Manual",
};

function docTitle(method: string | null): string {
  if (!method) return "Documento";
  return `Laudo · ${METHOD_LABELS[method] ?? method}`;
}

/**
 * Documentos do paciente = avaliações corporais com arquivo anexado (document_url):
 * laudos de DEXA/bioimpedância etc. A web só LÊ e linka o arquivo (não embute).
 * Upload pela web → bucket privado + signed URL é dívida pós-MVP (PENDENCIAS #12).
 */
export function DocumentsTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, refetch } = usePatientDocuments(patientId);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNotice("Upload de documento chega em breve (bucket privado + URL assinada).")}
        >
          <Upload className="h-4 w-4" />
          Enviar documento
        </Button>
      </div>

      {notice ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        isEmpty={!data || data.length === 0}
        onRetry={() => refetch()}
        emptyIcon={FileText}
        emptyTitle="Sem documentos"
        emptyDescription="Laudos e exames anexados às avaliações do paciente aparecerão aqui."
      >
        <div className="space-y-3">
          {(data ?? []).map((doc) => (
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
                    <CardTitle className="truncate text-base">{docTitle(doc.method)}</CardTitle>
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
    </div>
  );
}
