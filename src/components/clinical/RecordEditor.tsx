import { useEffect, useState } from "react";
import { Lock, Sparkles, Unlock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { EncounterPeople } from "@/lib/api/clinical";
import type { RecordFields } from "../../../supabase/functions/_shared/clinical/record";
import { fieldKey, type TemplateSection } from "../../../supabase/functions/_shared/clinical/template";
import { formatDateTimeBr, professionalSectionValues } from "@/lib/clinical/display";

interface Props {
  sections: TemplateSection[];
  fields: RecordFields;
  readOnly: boolean;
  /** ord → número do trecho (1..n) para o rótulo "Trecho n". */
  ordIndex: Map<number, number>;
  onSave: (key: string, value: string) => Promise<void>;
  onUnlock: (key: string) => Promise<void>;
  onSourceClick: (ord: number) => void;
  people: EncounterPeople | null | undefined;
  startedAt: string;
}

function FieldBox({ k, label, field, readOnly, ordIndex, onSave, onUnlock, onSourceClick }: {
  k: string;
  label: string;
  field: RecordFields[string] | undefined;
  readOnly: boolean;
  ordIndex: Map<number, number>;
  onSave: Props["onSave"];
  onUnlock: Props["onUnlock"];
  onSourceClick: Props["onSourceClick"];
}) {
  const server = field?.value ?? "";
  const [draft, setDraft] = useState(server);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // atualizações da IA entram no campo, exceto enquanto o profissional digita nele
  useEffect(() => {
    if (!dirty) setDraft(server);
  }, [server, dirty]);

  async function commit() {
    if (!dirty || draft === server) {
      setDirty(false);
      return;
    }
    setState("saving");
    try {
      await onSave(k, draft);
      setState("saved");
    } catch {
      setState("error");
    } finally {
      setDirty(false);
    }
  }

  const id = `f-${k}`;
  return (
    <div className="space-y-1" data-field={k}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {field?.locked ? (
          <Badge tone="info" className="gap-1">
            <Lock className="h-3 w-3" aria-hidden /> Editado por você
          </Badge>
        ) : field?.value ? (
          <Badge tone="primary" className="gap-1">
            <Sparkles className="h-3 w-3" aria-hidden /> Preenchido pela IA
          </Badge>
        ) : null}
      </div>
      {readOnly ? (
        <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm">{server || <span className="text-muted-foreground">Sem informação</span>}</p>
      ) : (
        <Textarea
          id={id}
          value={draft}
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          placeholder="Sem informação"
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
            setState("idle");
          }}
          onBlur={() => void commit()}
        />
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {field?.sources?.length ? (
          <>
            <span>Origem:</span>
            {field.sources.map((o) => (
              <button key={o} type="button" className="rounded border px-1.5 py-0.5 hover:bg-accent" onClick={() => onSourceClick(o)}>
                Trecho {ordIndex.get(o) ?? "?"}
              </button>
            ))}
          </>
        ) : null}
        {!readOnly && field?.locked ? (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void onUnlock(k)}>
            <Unlock className="h-3 w-3" aria-hidden /> Devolver para a IA
          </Button>
        ) : null}
        {state === "saving" ? <span>Salvando…</span> : null}
        {state === "saved" ? <span className="text-success">Salvo</span> : null}
        {state === "error" ? <span className="text-destructive">Não salvou. Tente de novo.</span> : null}
      </div>
    </div>
  );
}

export function RecordEditor({ sections, fields, readOnly, ordIndex, onSave, onUnlock, onSourceClick, people, startedAt }: Props) {
  return (
    <div className="space-y-4" data-testid="record-editor">
      {sections.map((s) =>
        s.system ? (
          <Card key={s.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{s.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {professionalSectionValues(people, startedAt).map((r) => (
                <p key={r.label}>
                  <span className="font-medium">{r.label}:</span> {r.value}
                </p>
              ))}
              <p className="text-xs text-muted-foreground">Preenchido pelo sistema ({formatDateTimeBr(startedAt)}).</p>
            </CardContent>
          </Card>
        ) : (
          <Card key={s.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{s.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {s.fields.map((f) => {
                const k = fieldKey(s.id, f.id);
                return (
                  <FieldBox
                    key={k}
                    k={k}
                    label={f.label}
                    field={fields[k]}
                    readOnly={readOnly}
                    ordIndex={ordIndex}
                    onSave={onSave}
                    onUnlock={onUnlock}
                    onSourceClick={onSourceClick}
                  />
                );
              })}
            </CardContent>
          </Card>
        ),
      )}
    </div>
  );
}
