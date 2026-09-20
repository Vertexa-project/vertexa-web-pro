import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusChip({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "success" | "warning" | "destructive" | "info" | "muted" | "primary";
}) {
  return (
    <Badge tone={tone} className={cn("font-normal")}>
      {label}
    </Badge>
  );
}
