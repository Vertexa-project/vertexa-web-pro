import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Brand, BrandMark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/providers/auth-context";

/** Logo "G" do Google (inline, sem asset externo). */
function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

interface LocationState {
  from?: { pathname: string };
}

// Estilo de botão-link acessível (foco visível) reutilizado nos links do form.
const linkButton =
  "font-medium text-primary hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, signIn, signInWithGoogle } = useAuth();

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

  async function handleGoogle() {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signInWithGoogle(); // redireciona para o Google (não retorna aqui em caso de sucesso)
    } catch {
      setError("Não foi possível iniciar o login com Google. Tente novamente.");
      setSubmitting(false);
    }
  }

  function showSoon(message: string) {
    setError(null);
    setNotice(message);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand — gradiente laranja → preto */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary via-[hsl(20_90%_25%)] to-black p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-9 w-9" variant="onDark" />
          <span className="font-display text-xl font-bold tracking-[-0.01em]">VERTEXA</span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-3xl font-bold leading-tight">Plataforma de retenção clínica</h1>
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
            <Brand markClassName="h-9 w-9" wordmarkClassName="text-xl" />
            <p className="mt-3 text-sm text-muted-foreground">Plataforma de retenção clínica</p>
          </div>

          <h2 className="font-display text-2xl font-bold tracking-tight">Acessar painel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre com suas credenciais profissionais.
          </p>

          <Button
            type="button"
            variant="outline"
            className="mt-8 w-full gap-2"
            onClick={handleGoogle}
            disabled={submitting}
          >
            <GoogleGlyph />
            Entrar com Google
          </Button>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
