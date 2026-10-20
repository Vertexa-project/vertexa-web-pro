import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { progressPhotoErrorMessage } from "@/lib/api/assessments";
import { useUploadProgressPhoto } from "@/hooks/useBodyAssessments";
import { isPhotoPose, PHOTO_POSES, POSE_LABEL, validatePhotoDate, validatePhotoFile, type PhotoPose } from "@/lib/domain/photoPose";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const NO_POSE = "none";

/**
 * Envio de foto de progresso pelo PROFISSIONAL — inclusive fotos antigas (data retroativa) e com a
 * posição (frente/lado/costas). A barreira real é o servidor (RLS do storage + RPC).
 */
export function PhotoUploadDialog({
  patientId,
  open,
  onOpenChange,
  defaultPose,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultPose?: PhotoPose | null;
}) {
  const upload = useUploadProgressPhoto(patientId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [day, setDay] = useState(todayYmd());
  const [pose, setPose] = useState<string>(defaultPose ?? NO_POSE);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setDay(todayYmd());
    setPose(defaultPose ?? NO_POSE);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close(v: boolean) {
    if (upload.isPending) return;
    if (!v) reset();
    onOpenChange(v);
  }

  async function submit() {
    setError(null);
    if (!file) return setError("Escolha a foto.");
    const fileErr = validatePhotoFile(file);
    if (fileErr) return setError(fileErr);
    const dateErr = validatePhotoDate(day, todayYmd());
    if (dateErr) return setError(dateErr);
    try {
      await upload.mutateAsync({ file, takenOn: day, pose: isPhotoPose(pose) ? pose : null });
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(progressPhotoErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar foto de progresso</DialogTitle>
          <DialogDescription>
            Use para registrar fotos anteriores do paciente. Informe a data em que a foto foi tirada e a posição, para comparar sempre posições equivalentes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="photo-file">Foto</Label>
            <input
              id="photo-file"
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={upload.isPending}
              onChange={(e) => {
                setError(null);
                setFile(e.target.files?.[0] ?? null);
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
            <p className="text-xs text-muted-foreground">JPG, PNG ou WebP, até 10 MB.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="photo-day">Data da foto</Label>
              <input
                id="photo-day"
                type="date"
                value={day}
                max={todayYmd()}
                disabled={upload.isPending}
                onChange={(e) => setDay(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="photo-pose">Posição</Label>
              <Select value={pose} onValueChange={setPose} disabled={upload.isPending}>
                <SelectTrigger id="photo-pose" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHOTO_POSES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {POSE_LABEL[p]}
                    </SelectItem>
                  ))}
                  <SelectItem value={NO_POSE}>Sem posição</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={upload.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={upload.isPending}>
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {upload.isPending ? "Enviando…" : "Enviar foto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
