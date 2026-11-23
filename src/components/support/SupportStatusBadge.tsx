import { Badge } from "@/components/ui/badge";
import { supportStatusLabel, type SupportSide, type SupportStatus } from "@/lib/api/support";

export function SupportStatusBadge({ status, side }: { status: SupportStatus; side: SupportSide }) {
  const tone =
    status === "resolvido"
      ? "success"
      : (status === "respondido") === (side === "clinica")
        ? "info"
        : "warning";
  return (
    <Badge tone={tone} className="whitespace-normal">
      {supportStatusLabel(status, side)}
    </Badge>
  );
}
