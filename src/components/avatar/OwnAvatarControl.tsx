import { useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AvatarEditorDialog } from "@/components/avatar/AvatarEditorDialog";
import { ProfilePhoto } from "@/components/avatar/ProfilePhoto";
import { Button } from "@/components/ui/button";
import { removeMyAvatar, replaceMyAvatar } from "@/lib/api/avatar";
import { AVATAR_FEATURE_ENTITLEMENT } from "@/lib/avatar/constants";
import type { SourceCropRect } from "@/lib/avatar/cropGeometry";
import { avatarOpMessage } from "@/lib/avatar/messages";
import { decodeImageFile, releaseDecodedImage, renderAvatarBlob } from "@/lib/avatar/processAvatar";
import { validateAvatarImageFile } from "@/lib/avatar/validateImage";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

void AVATAR_FEATURE_ENTITLEMENT;

export function OwnAvatarControl({
  profileId,
  name,
  avatarPath,
  legacyUrl,
  sizeClassName = "h-16 w-16",
}: {
  profileId: string;
  name: string;
  avatarPath: string | null;
  legacyUrl?: string | null;
  sizeClassName?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const hasPhoto = Boolean(avatarPath || legacyUrl);

  useEffect(() => () => revokePreview(), []);

  function revokePreview() {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
  }

  function openPicker() {
    setError(null);
    setStatus(null);
    inputRef.current?.click();
  }

  async function onFile(list: FileList | null) {
    const next = list?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!next) return;
    const invalid = await validateAvatarImageFile(next);
    if (invalid) {
      setError(invalid);
      setStatus(null);
      return;
    }
    try {
      const decoded = await decodeImageFile(next);
      try {
        if (!decoded.width || !decoded.height) throw new Error("process");
      } finally {
        releaseDecodedImage(decoded);
      }
    } catch {
      setError(avatarOpMessage("process"));
      setStatus(null);
      return;
    }
    revokePreview();
    const url = URL.createObjectURL(next);
    objectUrl.current = url;
    setFile(next);
    setPreview(url);
    setError(null);
    setOpen(true);
  }

  function closeEditor(nextOpen: boolean) {
    if (busy) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setFile(null);
      setPreview(null);
      revokePreview();
    }
  }

  async function confirm(crop: SourceCropRect) {
    if (!file || busy) return;
    const token = ++generation.current;
    setBusy(true);
    setProgress(12);
    setError(null);
    try {
      const decoded = await decodeImageFile(file);
      if (!decoded.width || !decoded.height) throw new Error("process");
      setProgress(40);
      const rendered = await renderAvatarBlob(decoded, crop);
      setProgress(70);
      await replaceMyAvatar({ profileId, blob: rendered.blob, previousPath: avatarPath });
      if (token !== generation.current) return;
      setProgress(100);
      await queryClient.invalidateQueries({ queryKey: qk.myProfileAvatar(profileId) });
      await queryClient.invalidateQueries({ queryKey: ["avatar"] });
      setStatus("Foto atualizada.");
      setOpen(false);
      setFile(null);
      setPreview(null);
      revokePreview();
    } catch (err) {
      if (token !== generation.current) return;
      const message = err instanceof Error && /Arquivo|Formato|Falha|processar/.test(err.message)
        ? err.message
        : avatarOpMessage("save");
      setError(message);
    } finally {
      if (token === generation.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  async function removePhoto() {
    if (busy || !hasPhoto) return;
    const token = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      await removeMyAvatar();
      if (token !== generation.current) return;
      await queryClient.invalidateQueries({ queryKey: qk.myProfileAvatar(profileId) });
      await queryClient.invalidateQueries({ queryKey: ["avatar"] });
      setStatus("Foto removida.");
    } catch {
      if (token !== generation.current) return;
      setError(avatarOpMessage("remove"));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Alterar foto de perfil"
          >
            <ProfilePhoto
              name={name}
              avatarPath={avatarPath}
              legacyUrl={legacyUrl}
              className={cn(sizeClassName, "ring-1 ring-border transition group-hover:ring-primary/50")}
              alt={`Foto de ${name}`}
            />
            <span
              className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background"
              aria-hidden
            >
              <Camera className="h-3.5 w-3.5" />
            </span>
          </button>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{name}</p>
            <p className="text-xs text-muted-foreground">JPG, PNG ou WEBP · até 8 MB</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openPicker} disabled={busy}>
            Trocar foto
          </Button>
          {hasPhoto ? (
            <Button type="button" variant="ghost" size="sm" onClick={removePhoto} disabled={busy}>
              Remover foto
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => void onFile(event.target.files)}
      />
      <label htmlFor={inputId} className="sr-only">
        Selecionar imagem de perfil
      </label>
      {(status || error) && !open ? (
        <p role="status" className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? status}
        </p>
      ) : null}
      <AvatarEditorDialog
        open={open}
        imageUrl={preview}
        busy={busy}
        progress={progress}
        error={error}
        onOpenChange={closeEditor}
        onConfirm={(crop) => void confirm(crop)}
        onReselect={openPicker}
      />
    </div>
  );
}
