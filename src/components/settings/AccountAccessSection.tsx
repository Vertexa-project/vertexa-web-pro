import { useMemo, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { createPasswordForCurrentUser } from "@/lib/api/createPassword";
import {
  oauthPasswordSetupCopy,
  resolvePasswordSetupUX,
  type AuthIdentityUser,
} from "@/lib/auth/authIdentities";
import { classifyCreatePasswordError, CREATE_PASSWORD_SUCCESS_MESSAGE } from "@/lib/auth/createPassword";
import { PASSWORD_MIN_LENGTH, validateNewPassword } from "@/lib/auth/passwordRecovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccountAccessSection({ user }: { user: AuthIdentityUser }) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const setupUX = useMemo(() => resolvePasswordSetupUX(user), [user]);
  const canDefine = setupUX === "can_define_password";
  const configured = setupUX === "reported_password_configured" || success;

  if (!canDefine && !configured) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const check = validateNewPassword(password, confirmation);
    if (check.ok === false) {
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
      await createPasswordForCurrentUser(password);
      setSuccess(true);
      setEditing(false);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(classifyCreatePasswordError(cause).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">Acesso à conta</p>
        {configured ? (
          <p className="mt-1 text-sm text-muted-foreground">Senha configurada</p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{oauthPasswordSetupCopy(user)}</p>
        )}
      </div>

      {success ? (
        <p className="text-sm text-foreground" role="status">
          {CREATE_PASSWORD_SUCCESS_MESSAGE}
        </p>
      ) : null}

      {configured ? null : editing ? (
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="create-password">Nova senha</Label>
            <div className="relative">
              <Input
                id="create-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Mínimo de {PASSWORD_MIN_LENGTH} caracteres.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-password-confirm">Confirmar senha</Label>
            <Input
              id="create-password-confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar senha
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" size="sm" onClick={() => setEditing(true)}>
          Definir senha
        </Button>
      )}
    </div>
  );
}
