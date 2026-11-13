import { ShieldAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/** Aviso padrão quando o papel do usuário não alcança a tela (o servidor também recusa). */
export function NoAccess({ text = "Você não tem acesso a esta área. Peça ao administrador da clínica." }: { text?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground" role="note">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
        {text}
      </CardContent>
    </Card>
  );
}
