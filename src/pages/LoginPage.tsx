import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/providers/auth-context";

interface LocationState {
  from?: { pathname: string };
}

// Estilo de botão-link acessível (foco visível) reutilizado nos links do form.
const linkButton =
  "font-medium text-primary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, signIn, signInDemo } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const from = (location.state as LocationState | null)?.from?.pathname ?? "/";

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch {
      // Mensagem genérica — não vazar detalhes de auth.
      setError("E-mail ou senha inválidos. Verifique seus dados e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDemo() {
    signInDemo();
    navigate(from, { replace: true });
  }

  function showSoon(message: string) {
    setError(null);
    setNotice(message);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand — gradiente laranja → preto */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-[hsl(20_90%_25%)] to-black p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/15 backdrop-blur">
            <span className="text-base font-bold">V</span>
          </div>
          <span className="text-xl font-semibold tracking-tight">VERTEXA</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">Plataforma de retenção clínica</h1>
          <p className="mt-4 text-white/80">
            Médicos, nutricionistas e personal trainers acompanham seus pacientes em um só lugar —
            e reduzem o abandono.
          </p>
        </div>
        <p className="text-sm text-white/50">© {new Date().getFullYear()} VERTEXA</p>
      </div>

      {/* Card de acesso */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <span className="text-base font-bold">V</span>
              </div>
              <span className="text-xl font-semibold tracking-tight">VERTEXA</span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">Plataforma de retenção clínica</p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Acessar painel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre com suas credenciais profissionais.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="voce@clinica.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <button
                  type="button"
                  className={`text-xs ${linkButton}`}
                  onClick={() => showSoon("Recuperação de senha disponível em breve.")}
                >
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="text-sm text-info" role="status">
                {notice}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          <Button variant="outline" className="mt-3 w-full" onClick={handleDemo} disabled={submitting}>
            Entrar em modo demonstração
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Não tem conta?{" "}
            <button
              type="button"
              className={linkButton}
              onClick={() => showSoon("Cadastro disponível em breve. Fale com o administrador da clínica.")}
            >
              Cadastre-se
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
