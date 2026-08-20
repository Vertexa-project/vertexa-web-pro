import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/observability/sentry";
import { AuthContext } from "./auth-context";
import { queryClient } from "./query-client";

const LEGACY_DEMO_KEY = "vertexa-demo-session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Chave de um bypass que não existe mais. Não autentica ninguém; só evita lixo no storage.
    localStorage.removeItem(LEGACY_DEMO_KEY);

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
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

  const value = useMemo(
    () => ({
      session,
      isAuthenticated: Boolean(session),
      loading,
      signIn,
      signInWithGoogle,
      signOut,
    }),
    [session, loading, signIn, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
