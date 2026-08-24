/**
 * Réparation persistante des allocations historiques.
 * GET /finance/student-fees ne masque plus un reçu non alloué : le client
 * déclenche POST /finance/reconcile-payment-allocations, puis relit les obligations.
 * Jamais de somme des reçus pour « Montant encaissé ».
 */
import { reconcilePaymentAllocations } from "../services/api";

export async function ensureCanonicalPaymentAllocations(): Promise<void> {
  try {
    await reconcilePaymentAllocations();
  } catch {
    // 403 / offline : la vérité reste GET student-fees, sans projection client.
  }
}
