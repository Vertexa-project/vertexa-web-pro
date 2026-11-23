import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";

import { HelpMarkup } from "@/components/help/HelpMarkup";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminHelp, useSaveAdminArticle } from "@/hooks/useHelpAdmin";
import { helpMediaUrl, uploadHelpMedia, type AdminHelpArticle } from "@/lib/api/helpAdmin";
import { helpImageLine } from "@/lib/help/markup";
import { cn } from "@/lib/utils";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Editor({ article, categories }: { article: AdminHelpArticle | null; categories: { id: string; title: string }[] }) {
  const navigate = useNavigate();
  const save = useSaveAdminArticle();
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? categories[0]?.id ?? "");
  const [title, setTitle] = useState(article?.title ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [position, setPosition] = useState(String(article?.position ?? 1));
  const [published, setPublished] = useState(article?.isPublished ?? true);
  const [videoPath, setVideoPath] = useState<string | null>(article?.videoPath ?? null);
  const [busy, setBusy] = useState<null | "video" | "image">(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"texto" | "previa">("texto");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  async function onVideo(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("video");
    try {
      setVideoPath(await uploadHelpMedia(file, "video"));
    } catch (e) {
      setError(e instanceof Error && !e.message.includes("_") ? e.message : "Não foi possível enviar o vídeo.");
    } finally {
      setBusy(null);
    }
  }

  async function onImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("image");
    try {
      const path = await uploadHelpMedia(file, "image");
      const el = bodyRef.current;
      const at = el ? el.selectionEnd : body.length;
      const before = body.slice(0, at);
      const after = body.slice(at);
      const line = helpImageLine(path);
      const next = `${before}${before && !before.endsWith("\n") ? "\n" : ""}${line}\n${after}`;
      setBody(next);
    } catch (e) {
      setError(e instanceof Error && !e.message.includes("_") ? e.message : "Não foi possível enviar a imagem.");
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 2) {
      setError("Escreva um título com pelo menos 2 letras.");
      return;
    }
    try {
      await save.mutateAsync({
        id: article?.id ?? null,
        categoryId,
        title: title.trim(),
        summary: summary.trim(),
        body,
        videoPath,
        position: Number(position) || 0,
        isPublished: published,
      });
      navigate("/platform/ajuda", { state: { saved: title.trim() } });
    } catch {
      setError("Não foi possível salvar. Tente de novo.");
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-5">
      <div className="grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_6rem]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="art-title">Título</Label>
          <Input id="art-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Cadastrar um paciente" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="art-category">Assunto</Label>
          <select id="art-category" className={selectClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="art-position">Ordem</Label>
          <Input id="art-position" inputMode="numeric" value={position} onChange={(e) => setPosition(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1.5 md:col-span-3">
          <Label htmlFor="art-summary">Resumo (uma frase)</Label>
          <Input id="art-summary" value={summary} maxLength={200} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm md:col-span-3">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Publicado (aparece para as clínicas)
        </label>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold tracking-tight">Vídeo do tutorial (opcional)</h2>
        <p className="text-sm text-muted-foreground">MP4, WebM ou MOV, até 50 MB. Aparece no topo do tutorial.</p>
        <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only" aria-label="Arquivo de vídeo" onChange={(e) => { void onVideo(e.target.files?.[0]); e.target.value = ""; }} />
        {videoPath ? (
          <video src={helpMediaUrl(videoPath)} controls preload="metadata" className="mt-3 aspect-video w-full max-w-xl rounded-xl bg-black" />
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => videoInput.current?.click()}>
            {busy === "video" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
            {busy === "video" ? "Enviando vídeo…" : videoPath ? "Trocar vídeo" : "Enviar vídeo"}
          </Button>
          {videoPath ? (
            <Button type="button" variant="ghost" onClick={() => setVideoPath(null)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Tirar vídeo
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 font-semibold tracking-tight">Texto do tutorial</h2>
          <div role="tablist" className="flex gap-1 rounded-lg bg-muted p-1">
            {(["texto", "previa"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn("rounded-md px-3 py-1 text-sm font-medium", tab === t ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {t === "texto" ? "Escrever" : "Prévia"}
              </button>
            ))}
          </div>
        </div>
        {tab === "texto" ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Use “## ” para subtítulo, “1. ” para passos, “- ” para lista e **palavra** para negrito. Linha em branco
              separa parágrafos.
            </p>
            <Textarea
              ref={bodyRef}
              aria-label="Texto do tutorial"
              className="mt-3 min-h-[320px] font-mono text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Arquivo de imagem" onChange={(e) => { void onImage(e.target.files?.[0]); e.target.value = ""; }} />
            <Button type="button" variant="outline" size="sm" className="mt-3" disabled={busy !== null} onClick={() => imageInput.current?.click()}>
              {busy === "image" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}
              {busy === "image" ? "Enviando imagem…" : "Inserir imagem"}
            </Button>
          </>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-border p-4">
            {body.trim() ? <HelpMarkup body={body} /> : <p className="text-sm text-muted-foreground">Nada escrito ainda.</p>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending || busy !== null}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Salvar tutorial
        </Button>
        <Button asChild variant="ghost">
          <Link to="/platform/ajuda">Cancelar</Link>
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function PlatformHelpArticleEditor() {
  const { id } = useParams<{ id: string }>();
  const data = useAdminHelp();
  const isNew = id === "novo";
  const article = isNew ? null : data.data?.articles.find((a) => a.id === id) ?? null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/platform/ajuda">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Central de Ajuda
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold tracking-tight">{isNew ? "Novo tutorial" : "Editar tutorial"}</h1>
      {data.isLoading ? (
        <LoadingState />
      ) : data.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar.</p>
      ) : !isNew && !article ? (
        <p className="text-sm text-muted-foreground">Tutorial não encontrado.</p>
      ) : (
        <Editor key={article?.id ?? "novo"} article={article} categories={data.data?.categories ?? []} />
      )}
    </div>
  );
}
