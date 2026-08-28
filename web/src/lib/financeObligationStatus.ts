/**
 * F7 — libellés métier des obligations (présentation uniquement).
 * N'invente pas de solde. Le statut serveur reste l'autorité.
 */

export type FinanceObligationStatusKey = "paid" | "partial" | "unpaid" | "cancelled" | "exempt";

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function financeObligationStatusKey(status: unknown): FinanceObligationStatusKey {
  const value = normalizeStatus(status);
  if (value === "paye" || value === "paid" || value === "solde") return "paid";
  if (value.includes("partiel") || value === "partial") return "partial";
  if (value.includes("annul") || value === "cancelled" || value === "canceled") return "cancelled";
  if (value.includes("exoner")) return "exempt";
  return "unpaid";
}

export function financeObligationStatusLabel(status: unknown): string {
  const key = financeObligationStatusKey(status);
  const overdue = normalizeStatus(status).includes("retard");
  if (key === "paid") return "Payé";
  if (key === "partial") return "Partiellement payé";
  if (key === "cancelled") return "Annulé";
  if (key === "exempt") return "Exonéré";
  return overdue ? "Impayé — échéance dépassée" : "Impayé";
}

export function financePaymentStatusLabel(status: unknown): string {
  const value = normalizeStatus(status);
  if (value.includes("annul") || value === "cancelled" || value === "canceled") return "Annulé";
  if (value.includes("attente") || value === "pending") return "En attente";
  if (value.includes("refus") || value.includes("echou") || value === "failed") return "Refusé";
  if (value.includes("partiel")) return "Partiellement payé";
  if (value === "paye" || value === "paid" || value === "confirme" || value === "enregistre") {
    return "Payé";
  }
  return String(status ?? "").trim() || "—";
}
