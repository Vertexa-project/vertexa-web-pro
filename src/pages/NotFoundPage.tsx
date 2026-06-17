import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/feedback/EmptyState";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Página não encontrada"
        description="O endereço acessado não existe ou foi movido."
        action={<Button onClick={() => navigate("/")}>Voltar ao início</Button>}
      />
    </div>
  );
}
