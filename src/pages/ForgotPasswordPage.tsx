import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidResetEmail, PASSWORD_RESET_NOTICE } from "@/lib/auth/passwordRecovery";
import { useAuth } from "@/providers/auth-context";

import { AuthSpecialLayout } from "./auth/AuthSpecialLayout";

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!isValidResetEmail(email) || submitting) return;
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSpecialLayout title="Recuperar senha">
      <p className="text-sm text-muted-foreground">
        Informe o e-mail da sua conta. Se ela existir, enviaremos as instruções.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="reset-email">E-mail</Label>
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {sent ? (
          <p className="text-sm text-info" role="status">
            {PASSWORD_RESET_NOTICE}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Enviar link de recuperação
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Voltar ao login
        </Link>
      </p>
    </AuthSpecialLayout>
  );
}
