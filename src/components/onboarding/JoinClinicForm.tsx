import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Clock3, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyJoinRequests, useRequestClinicAccess } from "@/hooks/useClinicJoin";
import {
  JOIN_CODE_LENGTH,
  isExpectedJoinError,
  joinRequestErrorMessage,
  normalizeJoinCode,
  validateJoinCode,
} from "@/lib/domain/clinicJoin";
import { captureException } from "@/lib/observability/sentry";

/**
 * Solicitação de acesso a uma clínica pelo CÓDIGO (WP-JOIN-1) — substitui o texto morto que
 * mandava "falar com o administrador" sem dar meio nenhum de fazê-lo.
 *
 * O código também chega por LINK (`?code=XXXXXXXX`), para a clínica mandar um convite pronto no
 * WhatsApp; se vier na URL, o campo já nasce preenchido.
 *
 * Erros ESPERADOS (código inválido, conta já vinculada, sessão expirada) viram mensagem e NÃO vão
 * ao Sentry; só o inesperado é reportado (source:"join", sem PII — o código nunca é anexado).
 */
export function JoinClinicForm() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const qc = useQueryClient();

  const mine = useMyJoinRequests();
  const request = useRequestClinicAccess();

  // Código vindo do link. Só pré-preenche; o envio continua sendo um ato explícito da pessoa.
  const codeFromUrl = searchParams.get("code");
  useEffect(() => {
    if (codeFromUrl) setCode(normalizeJoinCode(codeFromUrl));
  }, [codeFromUrl]);

  const pending = (mine.data ?? []).find((r) => r.status === "pending");
  const lastRejected = (mine.data ?? []).find((r) => r.status === "rejected");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const check = validateJoinCode(code);
    if (!check.ok) {
      setFormError(check.message);
      return;
    }
    setFormError(null);
    request.mutate(check.value, {
      onSuccess: () => setJustSent(true),
      onError: (err) => {
        if (!isExpectedJoinError(err)) {
          // NUNCA anexar o código nem o e-mail: contexto lógico apenas.
          captureException(err, { source: "join", scope: "request-access" });
        }
      },
    });
  }

  // ── Estado: já existe um pedido aguardando decisão ────────────────────────────────
  if (pending || justSent) {
    return (
      <div className="space-y-3 text-left">
        <div className="flex items-center gap-2 text-foreground">
          <Clock3 className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-base font-semibold">Solicitação enviada</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Sua solicitação foi enviada e está aguardando aprovação do administrador da clínica.
          Assim que ele aprovar, seu acesso é liberado aqui.
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            // A liberação acontece no banco; só re-checamos identidade e pedidos.
            qc.invalidateQueries({ queryKey: ["profileByAuthUser"] });
            qc.invalidateQueries({ queryKey: ["currentProfessional"] });
            void mine.refetch();
          }}
          disabled={mine.isFetching}
        >
          {mine.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Já fui aprovada(o) — verificar
        </Button>
      </div>
    );
  }

  const errorMessage =
    formError ?? (request.isError ? joinRequestErrorMessage(request.error) : null);

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left" noValidate>
      {lastRejected ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Sua solicitação anterior não foi aprovada. Você pode tentar com outro código.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="join-code">
          Código da clínica <span className="text-destructive">*</span>
        </Label>
        <Input
          id="join-code"
          value={code}
          onChange={(e) => setCode(normalizeJoinCode(e.target.value))}
          maxLength={JOIN_CODE_LENGTH}
          placeholder="Ex.: ABCD2345"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono tracking-[0.2em]"
          aria-required="true"
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorMessage ? "join-code-error" : "join-code-help"}
          disabled={request.isPending}
        />
        <p id="join-code-help" className="text-xs text-muted-foreground">
          O código possui {JOIN_CODE_LENGTH} caracteres.
        </p>
      </div>

      {errorMessage ? (
        <p id="join-code-error" role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={request.isPending}>
        {request.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Enviando…
          </>
        ) : (
          "Entrar na clínica"
        )}
      </Button>
    </form>
  );
}
