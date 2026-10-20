import { useMemo, useState } from "react";
import { ImageIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProgressPhotoWithUrl } from "@/lib/api/assessments";
import { formatDate } from "@/lib/domain/format";
import { comparablePoses, groupByPose, POSE_LABEL, type PoseKey } from "@/lib/domain/photoPose";

function Frame({ photo, tag }: { photo: ProgressPhotoWithUrl | undefined; tag: string }) {
  return (
    <figure className="flex-1 space-y-1.5">
      <p className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{tag}</p>
      {photo?.display_url ? (
        // contain: a foto aparece inteira (cabeça aos pés) em qualquer proporção.
        <img
          src={photo.display_url}
          alt={`${tag}: foto de ${formatDate(photo.taken_at)}`}
          className="aspect-[3/4] w-full rounded-md border bg-muted object-contain"
        />
      ) : (
        <div role="img" aria-label={`${tag}: foto indisponível`} className="flex aspect-[3/4] w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}
      <figcaption className="text-center text-xs text-muted-foreground">{photo ? formatDate(photo.taken_at) : "—"}</figcaption>
    </figure>
  );
}

/**
 * Comparação lado a lado de duas fotos da MESMA posição. O profissional escolhe a posição e as duas
 * datas; o padrão é a mais antiga × a mais recente daquela posição.
 */
export function PhotoCompare({ photos }: { photos: ProgressPhotoWithUrl[] }) {
  const groups = useMemo(() => groupByPose(photos), [photos]);
  const poses = useMemo(() => comparablePoses(photos), [photos]);

  const [poseSel, setPoseSel] = useState<PoseKey | null>(null);
  const [beforeSel, setBeforeSel] = useState<string | null>(null);
  const [afterSel, setAfterSel] = useState<string | null>(null);

  if (poses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Para comparar, são necessárias pelo menos duas fotos na mesma posição (por exemplo, duas de frente).
      </p>
    );
  }

  const pose: PoseKey = poseSel && poses.includes(poseSel) ? poseSel : poses[0];
  const list = groups[pose];
  const before = list.find((p) => p.id === beforeSel) ?? list[0];
  const after = list.find((p) => p.id === afterSel) ?? list[list.length - 1];

  const opt = (p: ProgressPhotoWithUrl) => (
    <SelectItem key={p.id} value={p.id}>
      {formatDate(p.taken_at)}
    </SelectItem>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="cmp-pose">Posição</Label>
          <Select
            value={pose}
            onValueChange={(v) => {
              setPoseSel(v as PoseKey);
              setBeforeSel(null);
              setAfterSel(null);
            }}
          >
            <SelectTrigger id="cmp-pose" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {poses.map((k) => (
                <SelectItem key={k} value={k}>
                  {POSE_LABEL[k]} ({groups[k].length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-before">Antes</Label>
          <Select value={before.id} onValueChange={setBeforeSel}>
            <SelectTrigger id="cmp-before" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{list.map(opt)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cmp-after">Depois</Label>
          <Select value={after.id} onValueChange={setAfterSel}>
            <SelectTrigger id="cmp-after" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{list.map(opt)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="mx-auto flex max-w-xl gap-4">
        <Frame photo={before} tag="Antes" />
        <Frame photo={after} tag="Depois" />
      </div>
    </div>
  );
}
