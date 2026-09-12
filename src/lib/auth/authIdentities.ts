/** Detecção de método de auth para UI. Nunca concede role/clínica/paciente.
 *  Presença de identity `email` é evidência positiva.
 *  Ausência de `email` NÃO prova ausência de senha.
 */

const EMAIL_PROVIDERS = new Set(["email"]);

export type PasswordSetupUX = "can_define_password" | "reported_password_configured" | "unknown";

export type AuthIdentityUser = {
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
  identities?: Array<{ provider?: string | null } | null> | null;
} | null;

function normalizeProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const provider = value.trim().toLowerCase();
  return provider.length > 0 ? provider : null;
}

/** Une `app_metadata.providers` e `identities[].provider`. Sem `encrypted_password`. */
export function collectAuthProviders(user: AuthIdentityUser): string[] {
  const found = new Set<string>();
  const metaProviders = user?.app_metadata?.providers;
  if (Array.isArray(metaProviders)) {
    for (const item of metaProviders) {
      const provider = normalizeProvider(item);
      if (provider) found.add(provider);
    }
  }
  const single = normalizeProvider(user?.app_metadata?.provider);
  if (single) found.add(single);
  for (const identity of user?.identities ?? []) {
    const provider = normalizeProvider(identity?.provider);
    if (provider) found.add(provider);
  }
  return [...found].sort();
}

/** Evidência positiva de identity e-mail. Não implica o inverso. */
export function hasReportedEmailIdentity(user: AuthIdentityUser): boolean {
  return collectAuthProviders(user).some((provider) => EMAIL_PROVIDERS.has(provider));
}

export function hasOAuthIdentity(user: AuthIdentityUser): boolean {
  return collectAuthProviders(user).some((provider) => !EMAIL_PROVIDERS.has(provider));
}

/**
 * UX apenas. OAuth-only = capability UNKNOWN → ainda podemos oferecer Definir senha.
 * Lista vazia / usuário ausente = conservador.
 */
export function resolvePasswordSetupUX(user: AuthIdentityUser): PasswordSetupUX {
  if (hasReportedEmailIdentity(user)) return "reported_password_configured";
  if (hasOAuthIdentity(user)) return "can_define_password";
  return "unknown";
}

export function canDefinePasswordForCurrentIdentity(user: AuthIdentityUser): boolean {
  return resolvePasswordSetupUX(user) === "can_define_password";
}

export function oauthPasswordSetupCopy(user: AuthIdentityUser): string {
  const providers = collectAuthProviders(user);
  if (providers.includes("google") && !providers.includes("email")) {
    return "Você usa Google para acessar sua conta. Você também pode definir uma senha para entrar com seu e-mail.";
  }
  if (providers.includes("apple") && !providers.includes("email")) {
    return "Você usa Apple para acessar sua conta. Você também pode definir uma senha para entrar com seu e-mail.";
  }
  return "Você usa um provedor externo para acessar sua conta. Você também pode definir uma senha para entrar com seu e-mail.";
}
