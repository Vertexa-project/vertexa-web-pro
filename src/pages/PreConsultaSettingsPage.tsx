// Configurações › Pré-consulta (A1): liga/desliga o envio automático ao marcar consulta e edita as perguntas da clínica.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { usePreConsultaSettings, useSavePreConsultaSettings } from "@/hooks/usePreConsulta";
import { DEFAULT_QUESTIONS, MAX_LABEL, MAX_QUESTIONS, newQuestionId, validateQuestions, type PreConsultaQuestion } from "@/lib/domain/preConsulta";

export function PreConsultaSettingsPage() {
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);
  const settings = usePreConsultaSettings(isClinicAdmin ? clinicId : null);
  const save = useSavePreConsultaSettings(clinicId);
  const [autoSend, setAutoSend] = useState(false);
  const [questions, setQuestions] = useState<PreConsultaQuestion[]>(DEFAULT_QUESTIONS);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setAutoSend(settings.data.auto_send);
    setQuestions(settings.data.questions ?? DEFAULT_QUESTIONS);
  }, [settings.data]);

  if (adminLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pré-consulta" />
        <Card><CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />Verificando suas permissões…</CardContent></Card>
      </div>
    );
  }
  if (!isClinicAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pré-consulta" />
        <Card><CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />Apenas o administrador da clínica configura a pré-consulta.</CardContent></Card>
      </div>
    );
  }

  const edit = (i: number, label: string) => setQuestions((qs) => qs.map((q, k) => (k === i ? { ...q, label } : q)));
  const move = (i: number, d: -1 | 1) => setQuestions((qs) => {
    const j = i + d;
    if (j < 0 || j >= qs.length) return qs;
    const next = [...qs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i: number) => setQuestions((qs) => qs.filter((_, k) => k !== i));
  const add = () => setQuestions((qs) => [...qs, { id: newQuestionId(qs.map((q) => q.id)), label: "", type: "long" }]);

  const onSave = () => {
    setMessage(null);
    const cleaned = questions.map((q) => ({ ...q, label: q.label.trim() }));
    const problem = validateQuestions(cleaned);
    if (problem) { setMessage({ kind: "error", text: problem }); return; }
    const isDefault = JSON.stringify(cleaned) === JSON.stringify(DEFAULT_QUESTIONS);
    save.mutateAsync({ autoSend, questions: isDefault ? null : cleaned })
      .then(() => setMessage({ kind: "ok", text: "Configuração salva." }))
      .catch(() => setMessage({ kind: "error", text: "Não foi possível salvar. Tente novamente." }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Pré-consulta" description="Ficha curta e pedido de exames que o paciente recebe no app antes da consulta." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Envio automático</CardTitle>
          <CardDescription>Desligado por padrão. Mesmo desligado, a equipe pode enviar pela ficha do paciente (botão “Enviar pré-consulta”).</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} disabled={settings.isLoading} />
            <span>Enviar a pré-consulta automaticamente quando uma consulta for marcada na Agenda</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Perguntas</CardTitle>
          <CardDescription>
            Padrão baseado no roteiro de anamnese da clínica. Mudanças valem para os próximos envios (pedidos já enviados mantêm as perguntas que o paciente recebeu).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
          {settings.isError ? <p className="text-sm text-destructive">Não foi possível carregar a configuração.</p> : null}
          <ol className="space-y-3">
            {questions.map((q, i) => (
              <li key={q.id} className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Pergunta {i + 1}</span>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" aria-label={`Subir pergunta ${i + 1}`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Descer pergunta ${i + 1}`} onClick={() => move(i, 1)} disabled={i === questions.length - 1}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Remover pergunta ${i + 1}`} onClick={() => remove(i)} disabled={questions.length <= 1}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </div>
                </div>
                <Textarea value={q.label} maxLength={MAX_LABEL} rows={2} aria-label={`Texto da pergunta ${i + 1}`} onChange={(e) => edit(i, e.target.value)} />
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={add} disabled={questions.length >= MAX_QUESTIONS}><Plus className="h-4 w-4" aria-hidden />Adicionar pergunta</Button>
            <Button variant="outline" size="sm" onClick={() => setQuestions(DEFAULT_QUESTIONS)}>Restaurar perguntas padrão</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={save.isPending || settings.isLoading}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        {message ? <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p> : null}
      </div>
    </div>
  );
}
