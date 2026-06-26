import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "./query-client";
import { ThemeProvider } from "./theme-provider";
import { AuthProvider } from "./auth-provider";
import { RoleProvider } from "./role-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <RoleProvider>{children}</RoleProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
