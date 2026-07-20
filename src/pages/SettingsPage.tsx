import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Bell, Building2, CalendarDays, CreditCard, Monitor, Moon, ShieldCheck, Sun, UserRound } from "lucide-react";

import { GoogleCalendarConnection } from "@/components/calendar/GoogleCalendarConnection";
import { PageHeader } from "@/components/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentProfessional, useCurrentProfessionalName } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { initials, shortName } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-context";
import { useRole } from "@/providers/role-context";
import { useTheme, type Theme } from "@/providers/theme-context";

function SettingRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children ?? <span className="text-sm font-medium text-foreground">{value ?? "—"}</span>}
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </CardHeader>
      <CardContent className="divide-y divide-border pt-0">{children}</CardContent>
    </Card>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

function SoonButton({ children }: { children: React.ReactNode }) {
  return (
    <Button variant="outline" size="sm" disabled title="Em breve">
      {children}
    </Button>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { session, demoMode } = useAuth();
  const { data: professionalName } = useCurrentProfessionalName();
  const { data: professional } = useCurrentProfessional();
  const { roleLabel } = useRole(); // roleLabel: só DISPLAY. Autoridade de admin vem do sinal real abaixo.
  const { isClinicAdmin } = useIsClinicAdmin(professional?.clinicId ?? null);
  const navigate = useNavigate();

  // Retorno do OAuth do Google Calendar (.../configuracoes?calendar=connected|error): mostra um aviso
  // e limpa o param para não re-disparar em refresh/re-render.
  const [searchParams, setSearchParams] = useSearchParams();
  const [calendarNotice, setCalendarNotice] = useState<"connected" | "error" | null>(null);
  useEffect(() => {
    const calendar = searchParams.get("calendar");
    if (calendar === "connected" || calendar === "error") {
      setCalendarNotice(calendar);
      const next = new URLSearchParams(searchParams);
      next.delete("calendar");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const name = shortName(professionalName) ?? (demoMode ? "Dra. Camila Rocha" : "Profissional");
  const email = session?.user?.email ?? "demo@vertexa.app";

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Conta, segurança e preferências da clínica." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard icon={UserRound} title="Sua conta" description="Identidade do profissional logado.">
          <div className="flex items-center gap-3 py-3">
            <Avatar className="h-11 w-11">
              <AvatarFallback>{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{name}</p>
              <p className="truncate text-sm text-muted-foreground">{email}</p>
            </div>
            {demoMode ? (
              <Badge tone="primary" className="ml-auto shrink-0">
                Modo demonstração
              </Badge>
            ) : null}
          </div>
          <SettingRow label="Nome de exibição" value={name} />
          <SettingRow label="Papel">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              {roleLabel}
              {demoMode ? <Badge tone="muted">troque no menu de conta</Badge> : null}
            </span>
          </SettingRow>
          <SettingRow label="E-mail">
            <SoonButton>Alterar e-mail</SoonButton>
          </SettingRow>
        </SectionCard>

        <SectionCard icon={Building2} title="Clínica" description="Dados da clínica e equipe.">
          <SettingRow label="Clínica" value="Clínica Vértice" />
          <SettingRow label="Profissionais" value="Médica, Nutricionista" />
          {isClinicAdmin ? (
            <SettingRow label="Disciplinas da equipe">
              <Button variant="outline" size="sm" onClick={() => navigate("/configuracoes/disciplinas")}>
                Gerenciar
              </Button>
            </SettingRow>
          ) : null}
          <SettingRow label="Convidar profissional">
            <SoonButton>Convidar</SoonButton>
          </SettingRow>
        </SectionCard>

        <SectionCard icon={Sun} title="Aparência" description="Tema do painel (aplica imediatamente).">
          <div className="py-3">
            <div
              role="group"
              aria-label="Tema do painel"
              className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1"
            >
              {THEME_OPTIONS.map((opt) => {
                const active = theme === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              "Sistema" acompanha o tema do seu computador. A web é clara por padrão.
            </p>
          </div>
        </SectionCard>

        <SectionCard icon={CreditCard} title="Plano e assinatura" description="Cobrança é por clínica (B2B).">
          <SettingRow label="Plano atual">
            <Badge tone="success">Profissional · demo</Badge>
          </SettingRow>
          <SettingRow label="Pacientes ativos" value="3 de ilimitados" />
          <SettingRow label="Gerenciar assinatura">
            <SoonButton>Gerenciar</SoonButton>
          </SettingRow>
        </SectionCard>

        <SectionCard icon={Bell} title="Notificações" description="Como você é avisado de menções e pendências.">
          <SettingRow label="Menção em conversa" value="No painel (badge)" />
          <SettingRow label="Resumo diário por e-mail">
            <SoonButton>Ativar</SoonButton>
          </SettingRow>
          <SettingRow label="WhatsApp">
            <SoonButton>Conectar</SoonButton>
          </SettingRow>
        </SectionCard>

        <SectionCard
          icon={CalendarDays}
          title="Integrações"
          description="Conecte ferramentas externas (somente leitura)."
        >
          <div className="py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Google Calendar</span>
              {calendarNotice === "connected" ? (
                <Badge tone="success">Conectado com sucesso</Badge>
              ) : calendarNotice === "error" ? (
                <Badge tone="destructive">Falha ao conectar</Badge>
              ) : null}
            </div>
            <GoogleCalendarConnection
              clinicId={professional?.clinicId ?? null}
              professionalId={professional?.id ?? null}
              variant="full"
            />
          </div>
        </SectionCard>

        <SectionCard
          icon={ShieldCheck}
          title="Segurança e LGPD"
          description="Dados de saúde são tratados com rigor."
        >
          <SettingRow label="Dados sensíveis" value="Storage privado (pós-MVP)" />
          <SettingRow label="Acesso por papel/clínica" value="Em implantação" />
          <SettingRow label="Política de privacidade">
            <SoonButton>Ver política</SoonButton>
          </SettingRow>
        </SectionCard>
      </div>

    </div>
  );
}
