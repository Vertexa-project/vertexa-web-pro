import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { requestPasswordReset as requestPasswordResetApi, updatePassword as updatePasswordApi } from "@/lib/api/authPassword";
import { ensureMyProfile } from "@/lib/api/ensureMyProfile";
import { isPasswordRecoveryEvent } from "@/lib/auth/passwordRecovery";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/observability/sentry";
import { AuthContext } from "./auth-context";
import { queryClient } from "./query-client";

const LEGACY_DEMO_KEY = "vertexa-demo-session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    // Chave de um bypass que não existe mais. Não autentica ninguém; só evita lixo no storage.
    localStorage.removeItem(LEGACY_DEMO_KEY);

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        await ensureMyProfile().catch(() => undefined);
      }
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (next && event !== "SIGNED_OUT") {
        void ensureMyProfile().catch(() => undefined);
      }
      setSession(next);
      if (isPasswordRecoveryEvent(event)) setIsPasswordRecovery(true);
      if (event === "SIGNED_OUT") setIsPasswordRecovery(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      captureException(error, { source: "auth", scope: "oauth-start" });
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(LEGACY_DEMO_KEY);
    await supabase.auth.signOut();
    queryClient.clear();
  }, []);

  const requestPasswordReset = useCallback((email: string) => requestPasswordResetApi(email), []);
  const updatePassword = useCallback((password: string) => updatePasswordApi(password), []);

  const value = useMemo(
    () => ({
      session,
      isAuthenticated: Boolean(session),
      loading,
      isPasswordRecovery,
      signIn,
      signInWithGoogle,
      signOut,
      requestPasswordReset,
      updatePassword,
    }),
    [
      session,
      loading,
      isPasswordRecovery,
      signIn,
      signInWithGoogle,
      signOut,
      requestPasswordReset,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
