import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PASSWORD_FORGOT_PATH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_INVALID_MESSAGE,
  PASSWORD_UPDATED_MESSAGE,
  classifyAuthUrlError,
  resolveUpdatePasswordView,
  validateNewPassword,
} from "@/lib/auth/passwordRecovery";
import { useAuth } from "@/providers/auth-context";

import { AuthSpecialLayout } from "./auth/AuthSpecialLayout";

export function UpdatePasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, isPasswordRecovery, updatePassword, signOut } = useAuth();

  const urlError = classifyAuthUrlError(location.hash, location.search);
  const view = resolveUpdatePasswordView({
    authLoading: loading,
    isPasswordRecovery,
    urlError,
  });

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || success) return;

    const check = validateNewPassword(password, confirmation);
    if (!check.ok) {
      setError(
        check.reason === "mismatch"
          ? "As senhas não coincidem."
          : `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      );
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await updatePassword(password);
      setSuccess(true);
      await signOut();
      navigate("/login", { replace: true });
    } catch {
      setError("Não foi possível redefinir a senha. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (view === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (view === "invalid") {
    return (
      <AuthSpecialLayout title="Link inválido">
        <p className="text-sm text-muted-foreground">{PASSWORD_RESET_INVALID_MESSAGE}</p>
        <Button className="w-full" onClick={() => navigate(PASSWORD_FORGOT_PATH)}>
          Solicitar novo link
        </Button>
      </AuthSpecialLayout>
    );
  }

  return (
    <AuthSpecialLayout title="Redefinir senha">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-password">Nova senha</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
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
          <p className="text-xs text-muted-foreground">Mínimo de {PASSWORD_MIN_LENGTH} caracteres.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirmar nova senha</Label>
          <Input
            id="confirm-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="text-sm text-info" role="status">
            {PASSWORD_UPDATED_MESSAGE}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting || success}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Redefinir senha
        </Button>
      </form>
    </AuthSpecialLayout>
  );
}
