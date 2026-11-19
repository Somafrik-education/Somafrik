/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 4 — exports CSV / Excel des paiements.
 *
 * Le tableau des paiements traduit déjà le statut persisté (décision #1041) ; l'export partait
 * des lignes brutes et écrivait « Non imputé », « Partiellement imputé »… dans le fichier.
 * On applique ici exactement les mêmes libellés que le tableau. Les données persistées,
 * les champs API et les règles comptables ne changent pas.
 */
import { financePaymentStatusLabel, financeScreenFeeLabel } from "./financeObligationStatus";
import { paymentItemsDetailLabel } from "./quickPayment";

type Row = Record<string, unknown>;

export function formatEntityExportRows(moduleKey: string | undefined, rows: Row[]): Row[] {
  if (moduleKey !== "payments") return rows;
  return rows.map((row) => {
    const itemsDetail =
      financeScreenFeeLabel(paymentItemsDetailLabel(row.items) || String(row.itemsDetail ?? row.feeType ?? "")) || "";
    return {
      ...row,
      status: financePaymentStatusLabel(row.status),
      itemsDetail,
    };
  });
}
