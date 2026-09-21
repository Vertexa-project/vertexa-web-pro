export type BillingProviderEnvironment = "sandbox" | "production";

export interface ClinicBillingAccountFact {
  id: string;
  environment: BillingProviderEnvironment;
  createdAt: string;
  externalCustomerId: string | null;
}

export interface DualEnvPaymentFact {
  id: string;
  environment: BillingProviderEnvironment;
  amountCents: number;
  financialState: "received" | "pending" | "overdue";
}

/** Historical unsafe SQL: DISTINCT ON (clinic_id) ORDER BY created_at DESC. */
export function customerBoundDistinctOnNewest(accounts: readonly ClinicBillingAccountFact[]): boolean {
  const newest = [...accounts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  return newest != null && newest.externalCustomerId != null;
}

export function customerBoundAnyEnvironment(accounts: readonly ClinicBillingAccountFact[]): boolean {
  return accounts.some((row) => row.externalCustomerId != null);
}

export interface EnvironmentFinancialBucket {
  receivedCents: number;
  receivedCount: number;
  pendingCents: number;
  pendingCount: number;
  overdueCents: number;
  overdueCount: number;
}

export function emptyEnvironmentFinancialBucket(): EnvironmentFinancialBucket {
  return {
    receivedCents: 0,
    receivedCount: 0,
    pendingCents: 0,
    pendingCount: 0,
    overdueCents: 0,
    overdueCount: 0,
  };
}

export function financialBucketsByEnvironment(payments: readonly DualEnvPaymentFact[]): {
  sandbox: EnvironmentFinancialBucket;
  production: EnvironmentFinancialBucket;
} {
  const sandbox = emptyEnvironmentFinancialBucket();
  const production = emptyEnvironmentFinancialBucket();
  for (const row of payments) {
    const bucket = row.environment === "production" ? production : sandbox;
    if (row.financialState === "received") {
      bucket.receivedCents += row.amountCents;
      bucket.receivedCount += 1;
    } else if (row.financialState === "pending") {
      bucket.pendingCents += row.amountCents;
      bucket.pendingCount += 1;
    } else {
      bucket.overdueCents += row.amountCents;
      bucket.overdueCount += 1;
    }
  }
  return { sandbox, production };
}

export function receivedTotalsByEnvironment(payments: readonly DualEnvPaymentFact[]): {
  sandboxCents: number;
  productionCents: number;
  collapsedCents: number;
} {
  const sandboxCents = payments
    .filter((row) => row.environment === "sandbox" && row.financialState === "received")
    .reduce((sum, row) => sum + row.amountCents, 0);
  const productionCents = payments
    .filter((row) => row.environment === "production" && row.financialState === "received")
    .reduce((sum, row) => sum + row.amountCents, 0);
  return { sandboxCents, productionCents, collapsedCents: sandboxCents + productionCents };
}

export function timelineEventsCollapseEnvironment(
  events: ReadonlyArray<{ type: string; environment: BillingProviderEnvironment }>,
): { unlabeled: string[]; labeled: string[] } {
  return {
    unlabeled: events.map((row) => row.type),
    labeled: events.map((row) => `${row.environment}:${row.type}`),
  };
}
