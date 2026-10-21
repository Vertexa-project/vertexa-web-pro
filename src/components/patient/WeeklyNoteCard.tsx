import { useEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getWeeklyNote, setWeeklyNote } from "@/lib/api/weeklyNote";
import { mondayKey, noteError, NOTE_MAX } from "@/lib/domain/weeklyNote";

/** Recado da equipe que o paciente vê no Resumo da semana. Sem recado, o app mostra um texto automático. */
export function WeeklyNoteCard({ patientId }: { patientId: string }) {
  const week = mondayKey(new Date());
  const qc = useQueryClient();
  const key = ["weeklyNote", patientId, week];
  const saved = useQuery({ queryKey: key, queryFn: () => getWeeklyNote(patientId, week) });
  const [text, setText] = useState("");
  // Traz o recado salvo uma única vez (e de novo ao trocar de semana/paciente): não pisa no que a pessoa está digitando.
  const loadedFor = useRef<string | null>(null);
  const touched = useRef(false);
  useEffect(() => {
    if (saved.data !== undefined && loadedFor.current !== key.join("|")) {
      loadedFor.current = key.join("|");
      if (!touched.current) setText(saved.data ?? "");
    }
  }, [saved.data, key]);
  const save = useMutation({
    mutationFn: () => setWeeklyNote(patientId, week, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const err = noteError(text);
  const dirty = text.trim() !== (saved.data ?? "");

  return (
    <Card data-testid="weekly-note">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <MessageSquareText className="h-4 w-4 text-primary" aria-hidden />
        <CardTitle className="text-base">Recado da semana</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          O paciente vê este recado no Resumo da semana do app. Se deixar em branco, ele vê um recado automático, de acordo com o desempenho da semana.
        </p>
        <Textarea
          aria-label="Recado da semana"
          value={text}
          onChange={(e) => { touched.current = true; setText(e.target.value); }}
          placeholder="Ex.: Ótima semana! Vamos subir a carga do treino B."
          rows={3}
        />
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs ${err ? "text-destructive" : "text-muted-foreground"}`}>{`${text.trim().length}/${NOTE_MAX}`}</span>
          <div className="flex items-center gap-3">
            {save.isError ? <span className="text-xs text-destructive" role="alert">Não foi possível salvar.</span> : null}
            {save.isSuccess && !dirty ? <span className="text-xs text-muted-foreground">Salvo</span> : null}
            <Button size="sm" onClick={() => save.mutate()} disabled={Boolean(err) || !dirty || save.isPending}>
              {text.trim() === "" && saved.data ? "Voltar ao automático" : "Salvar recado"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
