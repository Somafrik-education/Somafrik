import { formatFinanceAmount, formatFinanceDate } from "../../lib/financeCurrency";
import {
  financeObligationStatusLabel,
  financeObligationStatusKey,
} from "../../lib/financeObligationStatus";

export type OpenObligationCard = {
  obligationId: string;
  label: string;
  periodLabel?: string;
  className?: string;
  balance: number;
  amountDue?: number;
  amountPaid?: number;
  dueDate?: string | null;
  status?: string;
  currency: string;
};

export function OpenObligationCards({
  obligations,
  currency,
}: {
  obligations: OpenObligationCard[];
  currency: string;
}) {
  if (!obligations.length) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-slate-50 px-4 py-3 text-sm text-muted">
        Aucune obligation ouverte pour cet élève. Le montant saisi sera enregistré en non imputé.
      </p>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Obligations ouvertes">
      {obligations.map((row) => {
        const statusLabel = financeObligationStatusLabel(row.status || "À payer");
        const key = financeObligationStatusKey(row.status || "À payer");
        return (
          <li
            key={row.obligationId}
            className="rounded-xl border border-line bg-white px-4 py-3 text-sm"
            data-testid={`open-obligation-${row.obligationId}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{row.label}</p>
                <p className="text-xs text-muted">
                  {[row.periodLabel, row.className].filter(Boolean).join(" · ") || "Sans période"}
                </p>
              </div>
              <p
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  key === "partial" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"
                }`}
              >
                {statusLabel}
              </p>
            </div>
            <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted">Montant initial</dt>
                <dd className="font-semibold">{formatFinanceAmount(row.amountDue, row.currency || currency)}</dd>
              </div>
              <div>
                <dt className="text-muted">Déjà payé</dt>
                <dd className="font-semibold">{formatFinanceAmount(row.amountPaid, row.currency || currency)}</dd>
              </div>
              <div>
                <dt className="text-muted">Reste à payer</dt>
                <dd className="font-semibold">{formatFinanceAmount(row.balance, row.currency || currency)}</dd>
              </div>
            </dl>
            {row.dueDate ? (
              <p className="mt-1 text-xs text-muted">Échéance : {formatFinanceDate(row.dueDate)}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
