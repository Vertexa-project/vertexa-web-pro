import { useState } from "react";
import { ImageIcon, Plus } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { PhotoCompare } from "./PhotoCompare";
import { PhotoUploadDialog } from "./PhotoUploadDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProgressPhotos, useSetProgressPhotoPose } from "@/hooks/useBodyAssessments";
import { progressPhotoErrorMessage, type ProgressPhotoWithUrl } from "@/lib/api/assessments";
import { formatDate } from "@/lib/domain/format";
import { groupByPose, isPhotoPose, PHOTO_POSES, POSE_LABEL, POSE_ORDER, poseKey, sortAsc, type PoseKey } from "@/lib/domain/photoPose";

type Filter = "all" | PoseKey;

function Thumb({ photo, onPose, busy }: { photo: ProgressPhotoWithUrl; onPose: (id: string, v: string) => void; busy: boolean }) {
  const key = poseKey(photo);
  return (
    <figure className="space-y-1.5">
      <div className="relative">
        {photo.display_url ? (
          <img
            src={photo.display_url}
            alt={`Foto de progresso de ${formatDate(photo.taken_at)}`}
            loading="lazy"
            className="aspect-[3/4] w-full rounded-md bg-muted object-contain"
          />
        ) : (
          <div role="img" aria-label={`Foto de progresso de ${formatDate(photo.taken_at)} indisponível`} className="flex aspect-[3/4] w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">{POSE_LABEL[key]}</span>
      </div>
      <figcaption className="text-xs text-muted-foreground">{formatDate(photo.taken_at)}</figcaption>
      <Select value={key} onValueChange={(v) => onPose(photo.id, v)} disabled={busy}>
        <SelectTrigger className="h-7 text-xs" aria-label={`Posição da foto de ${formatDate(photo.taken_at)}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PHOTO_POSES.map((p) => (
            <SelectItem key={p} value={p}>
              {POSE_LABEL[p]}
            </SelectItem>
          ))}
          <SelectItem value="none">Sem posição</SelectItem>
        </SelectContent>
      </Select>
    </figure>
  );
}

/** Galeria de fotos de progresso por posição, envio de fotos antigas e comparação de datas. */
export function PhotosSection({ patientId }: { patientId: string }) {
  const photos = useProgressPhotos(patientId);
  const setPose = useSetProgressPhotoPose(patientId);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const all = photos.data ?? [];
  const groups = groupByPose(all);
  const shown: ProgressPhotoWithUrl[] = filter === "all" ? sortAsc(all).reverse() : [...groups[filter]].reverse();

  async function changePose(id: string, v: string) {
    setNotice(null);
    try {
      await setPose.mutateAsync({ photoId: id, pose: isPhotoPose(v) ? v : null });
    } catch (err) {
      setNotice(progressPhotoErrorMessage(err));
    }
  }

  const chips: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "Todas", count: all.length },
    ...POSE_ORDER.map((k) => ({ key: k as Filter, label: POSE_LABEL[k], count: groups[k].length })),
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Fotos de progresso</CardTitle>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="h-4 w-4" />
            Adicionar foto
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por posição">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setFilter(c.key)}
                aria-pressed={filter === c.key}
                disabled={c.key !== "all" && c.count === 0}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  filter === c.key ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-foreground hover:bg-muted"
                }`}
              >
                {c.label} ({c.count})
              </button>
            ))}
          </div>
          {notice ? (
            <p role="alert" className="text-sm text-destructive">
              {notice}
            </p>
          ) : null}
          <AsyncSection
            isLoading={photos.isLoading}
            isError={photos.isError}
            isEmpty={all.length === 0}
            onRetry={() => photos.refetch()}
            emptyIcon={ImageIcon}
            emptyTitle="Sem fotos de progresso"
            emptyDescription="As fotos enviadas pelo paciente no app aparecem aqui. Você também pode adicionar fotos antigas."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {shown.map((p) => (
                <Thumb key={p.id} photo={p} onPose={changePose} busy={setPose.isPending} />
              ))}
            </div>
          </AsyncSection>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comparar fotos</CardTitle>
        </CardHeader>
        <CardContent>
          <PhotoCompare photos={all} />
        </CardContent>
      </Card>

      <PhotoUploadDialog patientId={patientId} open={uploadOpen} onOpenChange={setUploadOpen} defaultPose={filter !== "all" && isPhotoPose(filter) ? filter : null} />
    </>
  );
}
