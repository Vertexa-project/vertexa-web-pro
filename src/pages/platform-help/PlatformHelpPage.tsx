import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ExternalLink, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, Video } from "lucide-react";

import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAdminHelp,
  useDeleteAdminCategory,
  useHelpSettings,
  useSaveAdminCategory,
  useSaveHelpSettings,
} from "@/hooks/useHelpAdmin";
import { formatWhatsapp, type AdminHelpCategory } from "@/lib/api/helpAdmin";

function errText(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? "");
  if (msg.includes("invalid_whatsapp")) return "WhatsApp inválido: use DDD e número (ex.: 98 99999-0000).";
  if (msg.includes("invalid_email")) return "E-mail inválido.";
  if (msg.includes("title_required")) return "Escreva um título com pelo menos 2 letras.";
  return "Não foi possível salvar. Tente de novo.";
}

function ContactCard() {
  const settings = useHelpSettings();
  const save = useSaveHelpSettings();
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setWhatsapp(settings.data.supportWhatsapp ? formatWhatsapp(settings.data.supportWhatsapp) : "");
    setEmail(settings.data.supportEmail);
    setHours(settings.data.supportHours);
  }, [settings.data]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      await save.mutateAsync({ supportWhatsapp: whatsapp, supportEmail: email, supportHours: hours });
      setNotice("Contato salvo. Já aparece na página Suporte da Central.");
    } catch (err) {
      setNotice(errText(err));
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">Contato do suporte</h2>
      <p className="text-sm text-muted-foreground">
        Aparece para as clínicas na página Suporte. Deixe em branco o que não quiser mostrar.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="help-whatsapp">WhatsApp do suporte</Label>
          <Input id="help-whatsapp" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(98) 99999-0000" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="help-email">E-mail do suporte</Label>
          <Input id="help-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="suporte@exemplo.com" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="help-hours">Horário de atendimento</Label>
          <Input id="help-hours" value={hours} maxLength={120} onChange={(e) => setHours(e.target.value)} placeholder="Seg a sex, 8h às 18h" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending || settings.isLoading}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Salvar contato
        </Button>
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function CategoryRow({ cat, count }: { cat: AdminHelpCategory; count: number }) {
  const save = useSaveAdminCategory();
  const remove = useDeleteAdminCategory();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(cat.title);
  const [description, setDescription] = useState(cat.description);
  const [position, setPosition] = useState(String(cat.position));
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 font-semibold">
          {cat.title} <span className="text-sm font-normal text-muted-foreground">· {count} {count === 1 ? "tutorial" : "tutoriais"} · ordem {cat.position}</span>
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Editar assunto ${cat.title}`}>
          <Pencil className="h-4 w-4" aria-hidden />
          Editar assunto
        </Button>
        {count === 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={remove.isPending}
            aria-label={`Excluir assunto ${cat.title}`}
            onClick={() => {
              if (window.confirm(`Excluir o assunto “${cat.title}”? Ele não tem tutoriais.`)) {
                remove.mutate(cat.id, { onError: () => setError("Não foi possível excluir. Tire os tutoriais do assunto antes.") });
              }
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Excluir assunto
          </Button>
        ) : null}
        {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_6rem_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await save.mutateAsync({ id: cat.id, title, description, position: Number(position) || 0 });
          setEditing(false);
        } catch (err) {
          setError(errText(err));
        }
      }}
    >
      <Input aria-label="Nome do assunto" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input aria-label="Descrição do assunto" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Input aria-label="Ordem do assunto" inputMode="numeric" value={position} onChange={(e) => setPosition(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Salvar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive md:col-span-4">{error}</p> : null}
    </form>
  );
}

function NewCategory({ nextPosition }: { nextPosition: number }) {
  const save = useSaveAdminCategory();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        Novo assunto
      </Button>
    );
  }
  return (
    <form
      className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await save.mutateAsync({ id: null, title, description, position: nextPosition });
          setOpen(false);
          setTitle("");
          setDescription("");
        } catch (err) {
          setError(errText(err));
        }
      }}
    >
      <Input aria-label="Nome do novo assunto" placeholder="Nome do assunto" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input aria-label="Descrição do novo assunto" placeholder="Descrição curta" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          Criar assunto
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive md:col-span-3">{error}</p> : null}
    </form>
  );
}

/** Plataforma › Central de Ajuda: tutoriais, assuntos e contato do suporte. */
export function PlatformHelpPage() {
  const data = useAdminHelp();
  const location = useLocation();
  const saved = (location.state as { saved?: string } | null)?.saved;
  const cats = data.data?.categories ?? [];
  const arts = data.data?.articles ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Central de Ajuda</h1>
          <p className="text-sm text-muted-foreground">
            Tutoriais e contato do suporte que as clínicas assinantes veem em /ajuda.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to="/ajuda">
            <ExternalLink className="h-4 w-4" aria-hidden />
            Abrir a Central
          </Link>
        </Button>
        <Button asChild>
          <Link to="/platform/ajuda/tutorial/novo">
            <Plus className="h-4 w-4" aria-hidden />
            Novo tutorial
          </Link>
        </Button>
        </div>
      </div>

      {saved ? (
        <p role="status" className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          Tutorial “{saved}” salvo.
        </p>
      ) : null}

      <ContactCard />

      {data.isLoading ? (
        <LoadingState />
      ) : data.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os tutoriais.</p>
      ) : (
        <section aria-labelledby="tutoriais-titulo" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="tutoriais-titulo" className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
              Tutoriais por assunto
            </h2>
            <NewCategory nextPosition={(cats.at(-1)?.position ?? 0) + 1} />
          </div>
          {cats.map((cat) => {
            const list = arts.filter((a) => a.categoryId === cat.id);
            return (
              <div key={cat.id} className="min-w-0 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <CategoryRow cat={cat} count={list.length} />
                {list.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum tutorial neste assunto.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {list.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 py-2.5">
                        <span className="w-8 shrink-0 text-sm tabular-nums text-muted-foreground">{a.position}</span>
                        <span className="min-w-0 flex-1 break-words text-sm font-medium">{a.title}</span>
                        {a.videoPath ? (
                          <Badge tone="info">
                            <Video className="mr-1 h-3 w-3" aria-hidden />
                            Vídeo
                          </Badge>
                        ) : null}
                        {a.isPublished ? (
                          <Badge tone="success">
                            <Eye className="mr-1 h-3 w-3" aria-hidden />
                            Publicado
                          </Badge>
                        ) : (
                          <Badge tone="muted">
                            <EyeOff className="mr-1 h-3 w-3" aria-hidden />
                            Oculto
                          </Badge>
                        )}
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/platform/ajuda/tutorial/${a.id}`} aria-label={`Editar ${a.title}`}>
                            <Pencil className="h-4 w-4" aria-hidden />
                            Editar
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
