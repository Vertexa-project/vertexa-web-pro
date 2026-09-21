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

export interface DualEnvPixFact {
  environment: BillingProviderEnvironment;
  status: string;
}

export function pixStatusByEnvironment(rows: readonly DualEnvPixFact[]): {
  sandbox: string | null;
  production: string | null;
} {
  return {
    sandbox: rows.find((row) => row.environment === "sandbox")?.status ?? null,
    production: rows.find((row) => row.environment === "production")?.status ?? null,
  };
}

export interface DualEnvDatedFact {
  environment: BillingProviderEnvironment;
  at: string;
  id: string;
}

export function latestFactByEnvironment(rows: readonly DualEnvDatedFact[]): {
  sandboxId: string | null;
  productionId: string | null;
} {
  const pick = (environment: BillingProviderEnvironment) =>
    [...rows]
      .filter((row) => row.environment === environment)
      .sort((a, b) => (a.at < b.at ? 1 : -1))[0]?.id ?? null;
  return { sandboxId: pick("sandbox"), productionId: pick("production") };
}

export interface DualEnvNextChargeFact {
  environment: BillingProviderEnvironment;
  dueDate: string;
}

export function nextChargeByEnvironment(rows: readonly DualEnvNextChargeFact[]): {
  sandboxDue: string | null;
  productionDue: string | null;
} {
  const pick = (environment: BillingProviderEnvironment) =>
    [...rows]
      .filter((row) => row.environment === environment)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0]?.dueDate ?? null;
  return { sandboxDue: pick("sandbox"), productionDue: pick("production") };
}

export type AgingBucketCode = "d1_7" | "d8_15" | "d16_30" | "d31_plus";

export interface DualEnvOverdueFact {
  environment: BillingProviderEnvironment;
  aging: AgingBucketCode;
  amountCents: number;
}

export function agingByEnvironment(rows: readonly DualEnvOverdueFact[]): Record<
  BillingProviderEnvironment,
  Record<AgingBucketCode, number>
> {
  const empty = (): Record<AgingBucketCode, number> => ({
    d1_7: 0,
    d8_15: 0,
    d16_30: 0,
    d31_plus: 0,
  });
  const sandbox = empty();
  const production = empty();
  for (const row of rows) {
    const bucket = row.environment === "production" ? production : sandbox;
    bucket[row.aging] += row.amountCents;
  }
  return { sandbox, production };
}
