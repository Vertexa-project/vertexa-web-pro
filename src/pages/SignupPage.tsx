import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { signUpWithEmail } from "@/lib/api/authSignup";
import { AUTH_RATE_LIMIT_MESSAGE, SIGNUP_GENERIC_ERROR_MESSAGE } from "@/lib/auth/authClientErrors";
import {
  SIGNUP_CHECK_EMAIL_BODY,
  SIGNUP_CHECK_EMAIL_TITLE,
  validateSignupForm,
  type SignupField,
} from "@/lib/auth/signup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AuthSpecialLayout } from "./auth/AuthSpecialLayout";

const FIELD_IDS: Record<SignupField, string> = {
  fullName: "signup-full-name",
  email: "signup-email",
  password: "signup-password",
  confirmation: "signup-confirmation",
};

export function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const submittingRef = useRef(false);

  function focusField(field: SignupField) {
    document.getElementById(FIELD_IDS[field])?.focus();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current || checkEmail) return;

    const check = validateSignupForm({ fullName, email, password, confirmation });
    if (!check.ok) {
      setError(check.message);
      focusField(check.field);
      return;
    }

    setError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await signUpWithEmail({
        email: check.email,
        password: check.password,
        fullName: check.fullName,
      });
      if (result.kind === "rate_limited") {
        setError(AUTH_RATE_LIMIT_MESSAGE);
        return;
      }
      if (result.kind === "failed") {
        setError(SIGNUP_GENERIC_ERROR_MESSAGE);
        return;
      }
      setCheckEmail(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (checkEmail) {
    return (
      <AuthSpecialLayout title={SIGNUP_CHECK_EMAIL_TITLE}>
        <p className="text-sm text-muted-foreground">{SIGNUP_CHECK_EMAIL_BODY}</p>
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Voltar ao login
          </Link>
        </p>
      </AuthSpecialLayout>
    );
  }

  return (
    <AuthSpecialLayout title="Criar conta">
      <p className="text-sm text-muted-foreground">
        Cadastre-se com e-mail e senha. Depois da confirmação, você escolhe como vai usar o Vertexa.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor={FIELD_IDS.fullName}>Nome completo</Label>
          <Input
            id={FIELD_IDS.fullName}
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={FIELD_IDS.email}>E-mail</Label>
          <Input
            id={FIELD_IDS.email}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={FIELD_IDS.password}>Senha</Label>
          <div className="relative">
            <Input
              id={FIELD_IDS.password}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
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
          <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={FIELD_IDS.confirmation}>Confirmar senha</Label>
          <div className="relative">
            <Input
              id={FIELD_IDS.confirmation}
              type={showConfirmation ? "text" : "password"}
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmation((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={showConfirmation ? "Ocultar confirmação de senha" : "Mostrar confirmação de senha"}
            >
              {showConfirmation ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "Criando conta…" : "Criar conta"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </AuthSpecialLayout>
  );
}
