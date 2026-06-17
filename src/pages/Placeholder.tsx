import { Construction } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/PageHeader";

interface PlaceholderProps {
  title: string;
  description?: string;
}

/** Tela placeholder para rotas que serão implementadas nas próximas fases. */
export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Construction}
        title="Em construção"
        description="Esta área será implementada nas próximas fases da sprint."
      />
    </div>
  );
}
