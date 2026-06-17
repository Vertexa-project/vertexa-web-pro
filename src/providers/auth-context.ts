import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";

export interface AuthContextValue {
  session: Session | null;
  /** Modo demonstração: entra sem auth real (leitura via anon, RLS off nesta sprint). */
  demoMode: boolean;
  isAuthenticated: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInDemo: () => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
