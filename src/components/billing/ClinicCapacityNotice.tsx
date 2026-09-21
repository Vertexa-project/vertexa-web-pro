import { useClinicCommercialUsage } from "@/hooks/useBillingCommercial";
import { capacityNotice } from "@/lib/domain/billingCommercial";

export function ClinicCapacityNotice({
  clinicId,
  kind,
}: {
  clinicId: string | null;
  kind: "professional" | "patient";
}) {
  const usage = useClinicCommercialUsage(clinicId, Boolean(clinicId));
  const cap = usage.data?.capacity;
  if (!cap?.enforced) return null;
  const remaining = kind === "professional" ? cap.remainingProfessionals : cap.remainingPatients;
  const allowed = kind === "professional" ? cap.allowedProfessionals : cap.allowedPatients;
  const notice = capacityNotice({
    remaining,
    allowed,
    kind,
    planCode: cap.planCode,
    canAddUnits: cap.planCode === "sync" || cap.planCode === "apex",
  });
  if (notice.tone === "ok") return null;
  return (
    <p
      role="status"
      className={
        notice.tone === "limit"
          ? "rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
          : "rounded-md border bg-muted/40 px-4 py-3 text-sm"
      }
    >
      <strong>{notice.title}.</strong> {notice.body}
    </p>
  );
}
