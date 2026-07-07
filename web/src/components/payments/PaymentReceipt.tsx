import type { PaymentRecord } from "../../lib/quickPayment";
import type { School } from "../../types";
import { formatMetric } from "../../lib/format";

interface PaymentReceiptProps {
  payment: PaymentRecord;
  school?: School | null;
}

export function PaymentReceipt({ payment, school }: PaymentReceiptProps) {
  const amount = Number(payment.amount ?? 0);
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
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Type de frais</dt>
          <dd>{String(payment.feeType ?? payment.label ?? "—")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Montant</dt>
          <dd className="text-lg font-black text-brand">
            {formatMetric(amount, currency)}
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
