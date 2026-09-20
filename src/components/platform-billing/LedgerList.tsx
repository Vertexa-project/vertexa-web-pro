import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { DataTable, type Column } from "@/components/data-table/DataTable";
import { cn } from "@/lib/utils";

interface LedgerListProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  ariaLabel: string;
  onRowHref?: (row: T) => string | null;
  mobile: (row: T) => ReactNode;
  attention?: (row: T) => boolean;
}

export function LedgerList<T>({
  columns,
  rows,
  getRowId,
  ariaLabel,
  onRowHref,
  mobile,
  attention,
}: LedgerListProps<T>) {
  const navigate = useNavigate();

  return (
    <>
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={getRowId}
          ariaLabel={ariaLabel}
          pageSize={25}
          onRowClick={
            onRowHref
              ? (row) => {
                  const href = onRowHref(row);
                  if (href) navigate(href);
                }
              : undefined
          }
        />
      </div>
      <ul className="space-y-3 md:hidden" aria-label={ariaLabel}>
        {rows.map((row) => {
          const href = onRowHref?.(row);
          const needsAttention = attention?.(row) === true;
          const body = (
            <div
              className={cn(
                "rounded-md border border-border/70 bg-card p-4",
                needsAttention && "border-l-4 border-l-destructive",
              )}
            >
              {mobile(row)}
            </div>
          );
          return (
            <li key={getRowId(row)}>
              {href ? (
                <button
                  type="button"
                  className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => navigate(href)}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
