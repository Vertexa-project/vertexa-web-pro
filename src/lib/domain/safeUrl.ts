// Allowlist de esquemas para URLs vindas do banco (dados que o app/seed gravam).
// Como na sprint o INSERT é permissivo (with check true em body_assessments), um valor
// malicioso (javascript:, data:text/html,<script>…) gravado por um client anon dispararia
// no contexto da web se fosse usado cru num <a href>. Por isso só linkamos esquemas seguros.
//
// Sprint: aceitamos https:// e data:application/pdf;base64, (o seed de laudo é um PDF data URI).
// Produção (PENDENCIAS #12): documento vira bucket privado + signed URL (sempre https) — a regra
// continua válida e mais restrita.

/** É seguro abrir esta URL de documento num <a href>? (allowlist de esquema) */
export function isSafeDocumentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const v = url.trim();
  return /^https:\/\//i.test(v) || /^data:application\/pdf;base64,/i.test(v);
}
