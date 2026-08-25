/**
 * Réparation persistante des allocations historiques.
 * POST /finance/reconcile-payment-allocations reste explicite et idempotent.
 * Jamais depuis GET /payments ou GET /finance/student-fees.
 * Jamais de somme des reçus pour le taux / le reste à payer.
 *
 * Fail-soft uniquement : 403 et vraie coupure réseau.
 * 400/401/404/409/5xx doivent remonter — jamais un faux 0 FC silencieux.
 */
import { classifyLoadFailure } from "./dataTruth";

export function isSoftPaymentAllocationReconcileFailure(error: unknown): boolean {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : Number.NaN;
  if (status === 403) return true;
  if (Number.isFinite(status) && status > 0 && status !== 408) return false;
  return classifyLoadFailure(error).status === "offline";
}

export async function ensureCanonicalPaymentAllocations(
  reconcile: () => Promise<unknown>,
): Promise<void> {
  try {
    await reconcile();
  } catch (error) {
    if (isSoftPaymentAllocationReconcileFailure(error)) return;
    throw error;
  }
}

export async function withCanonicalPaymentAllocations<T>(
  load: () => Promise<T>,
  reconcile: () => Promise<unknown>,
): Promise<T> {
  await ensureCanonicalPaymentAllocations(reconcile);
  return load();
}
