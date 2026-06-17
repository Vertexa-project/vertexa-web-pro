import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";

interface AsyncSectionProps {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  children: React.ReactNode;
}

/** Padroniza loading/erro/vazio dentro de uma aba do prontuário. */
export function AsyncSection({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  children,
}: AsyncSectionProps) {
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={onRetry} />;
  if (isEmpty) return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
  return <>{children}</>;
}
