import { useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePlatformOnboardingTutorials,
  useSavePlatformOnboardingTutorial,
} from "@/hooks/useOnboardingTutorial";
import {
  TUTORIAL_AUDIENCE_LABEL,
  tutorialFileError,
  tutorialVideoUrl,
  uploadOnboardingTutorialVideo,
  type PlatformOnboardingTutorial,
} from "@/lib/api/onboardingTutorials";
import { formatDate } from "@/lib/domain/format";

function errorText(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (/video_required/.test(msg))
    return "Envie o vídeo antes de ligar o tutorial.";
  if (/platform_admin_required|row-level security|Unauthorized/i.test(msg))
    return "Só o administrador da plataforma pode mudar o tutorial.";
  if (/exceeded|too large|maximum allowed size/i.test(msg))
    return "O vídeo passa de 50 MB. Exporte em tamanho menor.";
  return msg || "Não foi possível salvar. Tente de novo.";
}

function TutorialEditor({
  tutorial,
}: {
  tutorial: PlatformOnboardingTutorial;
}) {
  const save = useSavePlatformOnboardingTutorial();
  const [title, setTitle] = useState(tutorial.title);
  const [videoPath, setVideoPath] = useState<string | null>(tutorial.videoPath);
  const [isActive, setIsActive] = useState(tutorial.isActive);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(tutorial.title);
    setVideoPath(tutorial.videoPath);
    setIsActive(tutorial.isActive);
  }, [tutorial.title, tutorial.videoPath, tutorial.isActive]);

  const dirty =
    title !== tutorial.title ||
    videoPath !== tutorial.videoPath ||
    isActive !== tutorial.isActive;
  const inputId = `tutorial-file-${tutorial.audience}`;
  const label = TUTORIAL_AUDIENCE_LABEL[tutorial.audience];

  async function onFile(file: File | undefined) {
    if (!file) return;
    const problem = tutorialFileError(file);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      setVideoPath(
        await uploadOnboardingTutorialVideo(tutorial.audience, file),
      );
    } catch (e) {
      setUploadError(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section
      aria-label={`Tutorial: ${label}`}
      className="space-y-3 rounded-lg border border-border/70 p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-foreground">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {tutorial.isActive ? "Aparece no primeiro acesso" : "Desligado"}
          {tutorial.updatedAt
            ? ` · alterado em ${formatDate(tutorial.updatedAt)}`
            : ""}
          {tutorial.updatedByName ? ` por ${tutorial.updatedByName}` : ""}
        </span>
      </div>

      {videoPath ? (
        <video
          key={videoPath}
          src={tutorialVideoUrl(videoPath)}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full max-w-md rounded-md bg-black"
          aria-label={`Vídeo atual: ${label}`}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum vídeo enviado.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="sr-only"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button asChild variant="outline" disabled={uploading}>
          <label htmlFor={inputId} className="cursor-pointer">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading
              ? "Enviando vídeo…"
              : videoPath
                ? "Trocar vídeo"
                : "Enviar vídeo"}
          </label>
        </Button>
        {videoPath ? (
          <Button
            variant="ghost"
            onClick={() => {
              setVideoPath(null);
              setIsActive(false);
            }}
          >
            Remover vídeo
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          MP4, WebM ou MOV, até 50 MB.
        </span>
      </div>
      {uploadError ? (
        <p role="alert" className="text-sm text-destructive">
          {uploadError}
        </p>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor={`tutorial-title-${tutorial.audience}`}>
          Título que aparece acima do vídeo
        </Label>
        <Input
          id={`tutorial-title-${tutorial.audience}`}
          value={title}
          maxLength={120}
          placeholder="Bem-vindo à Vertexa"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          disabled={!videoPath}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Mostrar no primeiro acesso
      </label>

      {save.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(save.error)}
        </p>
      ) : null}
      {save.isSuccess && !dirty ? (
        <p role="status" className="text-sm text-muted-foreground">
          Tutorial salvo.
        </p>
      ) : null}
      <Button
        disabled={!dirty || uploading || save.isPending}
        onClick={() =>
          save.mutate({
            audience: tutorial.audience,
            title: title.trim(),
            videoPath,
            isActive,
          })
        }
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Salvar tutorial
      </Button>
    </section>
  );
}

export function OnboardingTutorialsCard({ enabled }: { enabled: boolean }) {
  const list = usePlatformOnboardingTutorials(enabled);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tutoriais do primeiro acesso</CardTitle>
        <CardDescription>
          Vídeo curto que abre sozinho na primeira vez que a pessoa entra. Quem
          já usava o sistema não vê de novo; todos podem rever pelo menu da
          conta em “Tutorial do app”.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {list.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {list.isError ? (
          <ErrorState
            title="Não foi possível carregar os tutoriais"
            description="Tente de novo em instantes."
            onRetry={() => void list.refetch()}
          />
        ) : null}
        {list.data?.map((t) => (
          <TutorialEditor key={t.audience} tutorial={t} />
        ))}
      </CardContent>
    </Card>
  );
}
