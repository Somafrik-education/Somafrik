import { useEffect, useMemo, useState } from "react";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Field, Select } from "../../components/ui/Field";
import { PaymentReceipt } from "../../components/payments/PaymentReceipt";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { formatFinanceAmount, formatFinanceDate } from "../../lib/financeCurrency";
import {
  financeObligationStatusKey,
  financeObligationStatusLabel,
  financePaymentStatusLabel,
} from "../../lib/financeObligationStatus";
import {
  parentDashboardStudentKeys,
  resolveParentDashboardStudent,
} from "../../lib/parentDashboard";
import { buildParentFinanceModel } from "../../lib/parentFinance";
import {
  formatParentClassLabel,
  parentLinkedStudents,
  parentStudentLabel,
} from "../../lib/parentNotes";
import type { PaymentRecord } from "../../lib/quickPayment";
import type { StudentFee } from "../../types";

function studentValue(student: Record<string, unknown> | null | undefined) {
  if (!student) return "";
  return String(student.id ?? student.matricule ?? student.publicId ?? "").trim();
}

export function ParentFinancePage() {
  const { session } = useAuth();
  const { state, ensureDomains, loading, error } = useData();
  const user = session?.user ?? null;
  const schoolCode = String(user?.schoolCode ?? "").trim();

  const children = useMemo(
    () => parentLinkedStudents(user, state),
    [user, state],
  );
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedReceipt, setSelectedReceipt] = useState<PaymentRecord | null>(null);

  const selectedChild = useMemo(
    () => resolveParentDashboardStudent(user, state, selectedStudentId),
    [user, state, selectedStudentId],
  );

  useEffect(() => {
    void ensureDomains(
      ["students", "studentFees", "payments", "schools"],
      schoolCode ? { schoolCode } : undefined,
    ).catch(() => undefined);
  }, [ensureDomains, schoolCode]);

  useEffect(() => {
    if (!selectedChild) {
      if (selectedStudentId) setSelectedStudentId("");
      return;
    }
    const nextValue = studentValue(selectedChild);
    const requested = String(selectedStudentId).trim().toUpperCase();
    const allowed = parentDashboardStudentKeys(selectedChild).includes(requested);
    if (!allowed && nextValue) {
      setSelectedStudentId(nextValue);
    }
  }, [selectedChild, selectedStudentId]);

  useEffect(() => {
    setSelectedReceipt(null);
  }, [selectedStudentId]);

  const model = useMemo(
    () =>
      buildParentFinanceModel({
        student: selectedChild,
        studentFees: (state.studentFees ?? []) as StudentFee[],
        payments: (state.payments ?? []) as PaymentRecord[],
      }),
    [selectedChild, state.studentFees, state.payments],
  );

  const obligations = useMemo(
    () =>
      model.fees.filter(
        (fee) => financeObligationStatusKey(fee.status) !== "cancelled",
      ),
    [model.fees],
  );

  const school = useMemo(
    () =>
      state.schools.find(
        (row) =>
          String(row.code ?? row.schoolCode ?? "").trim().toUpperCase() ===
          schoolCode.toUpperCase(),
      ) ?? null,
    [schoolCode, state.schools],
  );

  const receiptPayment = useMemo(() => {
    if (!selectedReceipt) return null;
    return {
      ...selectedReceipt,
      studentName:
        selectedReceipt.studentName ??
        parentStudentLabel(selectedChild),
      className:
        selectedReceipt.className ??
        String(selectedChild?.className ?? ""),
    };
  }, [selectedChild, selectedReceipt]);

  if (!children.length) {
    return (
      <div className="space-y-6" data-testid="parent-finance-page">
        <SectionHeader
          title="Frais & paiements"
          description="Obligations et paiements de vos enfants."
        />
        <Card className="p-6">
          <p className="font-bold text-ink">Aucun enfant lié à votre compte.</p>
          <p className="mt-2 text-sm text-muted">
            Contactez l'établissement si un enfant devrait apparaître ici.
          </p>
        </Card>
      </div>
    );
  }

  const childName = parentStudentLabel(selectedChild);
  const childClass = formatParentClassLabel(
    selectedChild,
    user?.schoolPublicCode ?? "",
  );

  return (
    <div className="space-y-6" data-testid="parent-finance-page">
      <SectionHeader
        title="Frais & paiements"
        description="Consultez les obligations, les montants payés, le reste dû et les reçus de votre enfant."
      />

      {children.length > 1 ? (
        <Card className="p-4">
          <Field label="Enfant" htmlFor="parent-finance-child">
            <Select
              id="parent-finance-child"
              value={studentValue(selectedChild)}
              onChange={(event) => setSelectedStudentId(event.target.value)}
              options={children.map((child) => ({
                value: studentValue(child),
                label: parentStudentLabel(child),
              }))}
            />
          </Field>
        </Card>
      ) : null}

      <Card className="p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">
          Enfant sélectionné
        </p>
        <p className="mt-1 text-xl font-black text-ink">{childName || "Élève"}</p>
        <p className="mt-1 text-sm font-semibold text-muted">{childClass}</p>
      </Card>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-800">
            Les données financières n'ont pas pu être chargées complètement.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Montant attendu" value={model.expectedLabel} />
        <Metric label="Montant imputé" value={model.allocatedLabel} />
        <Metric label="Reste à payer" value={model.remainingLabel} />
        <Metric label="Paiements reçus" value={model.collectedLabel} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-black text-ink">Obligations</h2>
          <p className="mt-1 text-sm text-muted">
            Frais actuellement rattachés à l'enfant sélectionné.
          </p>
        </div>
        {obligations.length ? (
          <div className="divide-y divide-line">
            {obligations.map((fee) => (
              <ObligationRow key={fee.id} fee={fee} />
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm font-semibold text-muted">
            Aucune obligation disponible pour cet enfant.
          </p>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-black text-ink">Historique des paiements</h2>
          <p className="mt-1 text-sm text-muted">
            Paiements enregistrés pour l'enfant sélectionné.
          </p>
        </div>
        {model.payments.length ? (
          <div className="divide-y divide-line">
            {model.payments.map((payment, index) => {
              const currency = String(payment.currency ?? "").trim();
              const amount = Number(payment.amount ?? payment.totalAmount ?? 0);
              return (
                <div
                  key={String(payment.id ?? payment.reference ?? index)}
                  className="grid gap-3 px-5 py-4 lg:grid-cols-[1.1fr_1fr_1fr_auto] lg:items-center"
                >
                  <div>
                    <p className="font-black text-ink">
                      {formatFinanceAmount(amount, currency)}
                    </p>
                    <p className="text-xs font-semibold text-muted">
                      {formatFinanceDate(
                        String(payment.date ?? payment.paidAt ?? payment.createdAt ?? ""),
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-ink">
                      {String(payment.method ?? payment.paymentMethod ?? "Mode non renseigné")}
                    </p>
                    <p className="text-xs font-semibold text-muted">
                      {financePaymentStatusLabel(payment.status)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">
                      Référence
                    </p>
                    <p className="mt-1 font-mono text-sm font-bold text-ink">
                      {String(
                        payment.reference ??
                          payment.receiptId ??
                          payment.publicId ??
                          payment.id ??
                          "—",
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedReceipt(payment)}
                    className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-brand transition hover:border-brand/40 hover:bg-brand-50"
                  >
                    Voir le reçu
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm font-semibold text-muted">
            Aucun paiement enregistré pour cet enfant.
          </p>
        )}
      </Card>

      {receiptPayment ? (
        <section
          className="space-y-4 rounded-2xl border border-line bg-slate-50 p-4"
          aria-label="Reçu de paiement"
          data-testid="parent-payment-receipt"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div>
              <h2 className="font-black text-ink">Reçu de paiement</h2>
              <p className="text-sm text-muted">
                Consultation uniquement — aucune modification du paiement.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white"
              >
                Imprimer
              </button>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-bold text-ink"
              >
                Fermer
              </button>
            </div>
          </div>
          <PaymentReceipt
            payment={receiptPayment}
            school={school}
          />
        </section>
      ) : null}

      {loading ? (
        <p className="text-sm font-semibold text-muted">
          Actualisation des données financières…
        </p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-black uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 whitespace-pre-line text-2xl font-black text-ink">{value}</p>
    </Card>
  );
}

function ObligationRow({ fee }: { fee: StudentFee }) {
  const expected = Math.max(
    0,
    Number(fee.amountDue ?? 0) - Number(fee.exemption ?? 0),
  );
  const paid = Math.max(0, Number(fee.amountPaid ?? 0));
  const remaining = Math.max(0, expected - paid);

  return (
    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:items-center">
      <div>
        <p className="font-black text-ink">{fee.label || fee.feeType}</p>
        <p className="text-sm font-semibold text-muted">
          {fee.periodLabel || fee.academicYear || "Période non renseignée"}
        </p>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Attendu</p>
        <p className="mt-1 text-sm font-black text-ink">
          {formatFinanceAmount(expected, fee.currency)}
        </p>
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Payé</p>
        <p className="mt-1 text-sm font-black text-ink">
          {formatFinanceAmount(paid, fee.currency)}
        </p>
        <p className="text-xs font-semibold text-muted">
          Reste {formatFinanceAmount(remaining, fee.currency)}
        </p>
      </div>
      <div className="lg:text-right">
        <p className="text-sm font-black text-ink">
          {financeObligationStatusLabel(fee.status)}
        </p>
        <p className="text-xs font-semibold text-muted">
          Échéance {formatFinanceDate(fee.dueDate)}
        </p>
      </div>
    </div>
  );
}
