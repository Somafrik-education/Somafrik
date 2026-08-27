import type { PaymentRecord } from "../../lib/quickPayment";
import type { School } from "../../types";
import { formatMetric } from "../../lib/format";

interface PaymentReceiptProps {
  payment: PaymentRecord;
  school?: School | null;
}

function receiptItems(payment: PaymentRecord): { label: string; amount: number }[] {
  const items = Array.isArray(payment.items) ? payment.items : [];
  if (items.length) {
    return items.map((item) => {
      const row = item as { feeLabel?: string; feeType?: string; amount?: number };
      return {
        label: String(row.feeLabel || row.feeType || "Libellé"),
        amount: Number(row.amount ?? 0),
      };
    });
  }
  return [
    {
      label: String(payment.feeType ?? payment.label ?? "Libellé"),
      amount: Number(payment.totalAmount ?? payment.amount ?? 0),
    },
  ];
}

export function PaymentReceipt({ payment, school }: PaymentReceiptProps) {
  const items = receiptItems(payment);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const currency = String(payment.currency ?? school?.currency ?? "CDF");

  return (
    <div className="payment-receipt mx-auto max-w-md rounded-2xl border border-line bg-white p-8 text-sm text-ink print:border-0 print:shadow-none">
      <div className="border-b border-line pb-4 text-center">
        {school?.logoUrl ? (
          <img src={school.logoUrl} alt="" className="mx-auto mb-3 h-14 w-14 object-contain" />
        ) : (
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-lg font-black text-brand">
            {(school?.name ?? "S").slice(0, 1)}
          </div>
        )}
        <p className="text-lg font-black">{school?.name ?? "Établissement"}</p>
        <p className="text-xs text-muted">{school?.city ?? ""}{school?.phone ? ` · ${school.phone}` : ""}</p>
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-brand">Reçu de paiement</p>
      </div>

      <dl className="mt-5 space-y-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Référence</dt>
          <dd className="font-semibold">{String(payment.reference ?? payment.publicId ?? "—")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Élève</dt>
          <dd className="text-right font-semibold">{String(payment.studentName ?? "—")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Classe</dt>
          <dd>{String(payment.className ?? "—")}</dd>
        </div>
      </dl>

      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 font-semibold">Libellé</th>
            <th className="py-2 text-right font-semibold">Montant</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.label}-${index}`} className="border-b border-line/70">
              <td className="py-2">{item.label}</td>
              <td className="py-2 text-right font-semibold">{formatMetric(item.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 font-black">Total</td>
            <td className="pt-3 text-right text-lg font-black text-brand">
              {formatMetric(total, currency)}
            </td>
          </tr>
        </tfoot>
      </table>

      <dl className="mt-5 space-y-2">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Montant reçu</dt>
          <dd className="font-semibold">
            {formatMetric(Number(payment.amount ?? payment.totalAmount ?? total), currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Montant imputé</dt>
          <dd className="font-semibold">{formatMetric(Number(payment.allocatedAmount ?? 0), currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Montant non imputé</dt>
          <dd className="font-semibold">
            {formatMetric(Number(payment.unallocatedAmount ?? payment.overpaymentAmount ?? 0), currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Date</dt>
          <dd>{String(payment.date ?? "—")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Mode</dt>
          <dd>{String(payment.method ?? "—")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Statut</dt>
          <dd className="font-semibold">{String(payment.status ?? "—")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Saisi par</dt>
          <dd>{String(payment.createdByName ?? payment.createdBy ?? "—")}</dd>
        </div>
        {payment.comment ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Commentaire</dt>
            <dd className="max-w-[60%] text-right">{String(payment.comment)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 p-4 text-center">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Code de vérification</p>
        <p className="mt-1 font-mono text-base font-black tracking-wider">
          {String(payment.verificationCode ?? "—")}
        </p>
        <p className="mt-2 text-[11px] text-muted">
          Présentez ce code à l&apos;administration pour vérifier l&apos;authenticité du reçu.
        </p>
      </div>
    </div>
  );
}
