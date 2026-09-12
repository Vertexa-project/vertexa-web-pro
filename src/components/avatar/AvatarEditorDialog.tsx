import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { AVATAR_MAX_ZOOM, AVATAR_MIN_ZOOM } from "@/lib/avatar/constants";
import { clampPan, clampZoom, sourceCropRect, type SourceCropRect } from "@/lib/avatar/cropGeometry";
import { cn } from "@/lib/utils";

export function AvatarEditorDialog({
  open,
  imageUrl,
  busy,
  progress,
  error,
  onOpenChange,
  onConfirm,
  onReselect,
}: {
  open: boolean;
  imageUrl: string | null;
  busy: boolean;
  progress: number | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (crop: SourceCropRect, image: HTMLImageElement) => void;
  onReselect: () => void;
}) {
  const zoomId = useId();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [stageSize, setStageSize] = useState(320);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setNatural({ w: 0, h: 0 });
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth) {
      setNatural({ w: el.naturalWidth, h: el.naturalHeight });
    }
  }, [open, imageUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageSize(stage.clientWidth || 320);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, panX, panY };
  }, [busy, panX, panY]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !stageRef.current) return;
    const size = stageRef.current.clientWidth;
    const dx = (event.clientX - drag.current.x) / size;
    const dy = (event.clientY - drag.current.y) / size;
    setPanX(clampPan(drag.current.panX + dx * 2));
    setPanY(clampPan(drag.current.panY + dy * 2));
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  function confirm() {
    const image = imgRef.current;
    const stage = stageRef.current;
    if (!image || !stage || !natural.w || !natural.h) return;
    const crop = sourceCropRect({
      imageWidth: natural.w,
      imageHeight: natural.h,
      viewport: stage.clientWidth,
      zoom,
      panX,
      panY,
    });
    onConfirm(crop, image);
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="max-w-[28rem] sm:max-w-[28rem]" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>Ajustar foto</DialogTitle>
          <DialogDescription>
            Arraste para reposicionar. Use o zoom para enquadrar o rosto.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div
            ref={stageRef}
            className={cn(
              "relative mx-auto aspect-square w-full max-w-[min(100%,min(20rem,42dvh))] touch-none overflow-hidden rounded-full",
              "bg-[hsl(24_12%_10%)] ring-2 ring-primary/80 ring-offset-4 ring-offset-background",
              busy ? "cursor-wait" : "cursor-grab active:cursor-grabbing",
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="img"
            aria-label="Pré-visualização circular da foto"
          >
            {imageUrl ? (
              <img
                ref={imgRef}
                src={imageUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={previewStyle(natural.w, natural.h, stageSize, zoom, panX, panY)}
                onLoad={(event) => {
                  const el = event.currentTarget;
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
              />
            ) : null}
            {busy ? (
              <div className="absolute inset-0 grid place-items-center bg-black/45 text-sm font-medium text-white">
                {progress != null ? `Enviando… ${progress}%` : "Processando…"}
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor={zoomId}>Zoom</Label>
            <input
              id={zoomId}
              type="range"
              min={AVATAR_MIN_ZOOM}
              max={AVATAR_MAX_ZOOM}
              step={0.05}
              value={zoom}
              disabled={busy}
              onChange={(event) => setZoom(clampZoom(Number(event.target.value)))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
              aria-valuemin={AVATAR_MIN_ZOOM}
              aria-valuemax={AVATAR_MAX_ZOOM}
              aria-valuenow={zoom}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onReselect} disabled={busy}>
            Escolher outra
          </Button>
          <Button type="button" onClick={confirm} disabled={busy || !imageUrl || natural.w === 0}>
            {imageUrl && natural.w === 0 ? "Carregando…" : "Usar esta foto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function previewStyle(
  w: number,
  h: number,
  viewport: number,
  zoom: number,
  panX: number,
  panY: number,
): React.CSSProperties {
  if (!w || !h || !viewport) return { opacity: 0 };
  const cover = Math.max(viewport / w, viewport / h);
  const scale = cover * zoom;
  const drawW = w * scale;
  const drawH = h * scale;
  const maxX = Math.max(0, (drawW - viewport) / 2);
  const maxY = Math.max(0, (drawH - viewport) / 2);
  return {
    width: drawW,
    height: drawH,
    left: (viewport - drawW) / 2 + clampPan(panX) * maxX,
    top: (viewport - drawH) / 2 + clampPan(panY) * maxY,
  };
}
