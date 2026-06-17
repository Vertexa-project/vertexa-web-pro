import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { AuthContext } from "./auth-context";

const DEMO_KEY = "vertexa-demo-session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [demoMode, setDemoMode] = useState<boolean>(
    () => localStorage.getItem(DEMO_KEY) === "1",
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  const signInDemo = useCallback(() => {
    localStorage.setItem(DEMO_KEY, "1");
    setDemoMode(true);
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(DEMO_KEY);
    setDemoMode(false);
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      session,
      demoMode,
      isAuthenticated: Boolean(session) || demoMode,
      loading,
      signIn,
      signInDemo,
      signOut,
    }),
    [session, demoMode, loading, signIn, signInDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
