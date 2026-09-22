import { useEffect, useMemo, useState } from "react";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Field, Select } from "../../components/ui/Field";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { formatFinanceAmount, formatFinanceDate } from "../../lib/financeCurrency";
import { parentLinkedStudents, parentStudentLabel } from "../../lib/parentNotes";

function studentKeys(student: Record<string, unknown> | null) {
  if (!student) return new Set<string>();
  return new Set(
    [student.id, student.studentId, student.studentUuid, student.publicId, student.matricule, student.studentCode]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
}

export function ParentFinancePage() {
  const { session } = useAuth();
  const { state, ensureDomains } = useData();
  const user = session?.user ?? null;
  const schoolCode = String(user?.schoolCode ?? "").trim();
  const children = useMemo(() => parentLinkedStudents(user, state), [user, state]);
  const [selectedStudentId, setSelectedStudentId] = useState("");

  useEffect(() => {
    void ensureDomains(
      ["students", "studentFees", "payments"],
      schoolCode ? { schoolCode } : undefined,
    ).catch(() => undefined);
  }, [ensureDomains, schoolCode]);

  useEffect(() => {
    if (!children.length) {
      setSelectedStudentId("");
      return;
    }
    if (!children.some((child) => String(child.id ?? "") === selectedStudentId)) {
      setSelectedStudentId(String(children[0].id ?? ""));
    }
  }, [children, selectedStudentId]);

  const selectedChild =
    children.find((child) => String(child.id ?? "") === selectedStudentId) ?? children[0] ?? null;
  const keys = useMemo(() => studentKeys(selectedChild), [selectedChild]);
  const fees = (state.studentFees ?? []).filter((row) =>
    keys.has(String(row.studentId ?? "").trim()),
  );
  const payments = (state.payments as Record<string, unknown>[]).filter((row) =>
    keys.has(String(row.studentId ?? "").trim()),
  );

  const amountDue = fees.reduce((sum, row) => sum + Number(row.amountDue ?? 0), 0);
  const amountPaid = fees.reduce((sum, row) => sum + Number(row.amountPaid ?? 0), 0);
  const balance = fees.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
  const currency = String(fees.find((row) => row.currency)?.currency ?? payments.find((row) => row.currency)?.currency ?? "");

  return (
    <div className="space-y-6" data-testid="parent-finance-page">
      <SectionHeader
        title="Frais & paiements"
        description="Obligations, montants payés, solde restant et historique de votre enfant."
      />

      {children.length > 1 ? (
        <Card className="p-4">
          <Field label="Enfant">
            <Select
              aria-label="Enfant"
              value={selectedStudentId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
              options={children.map((child) => ({
                value: String(child.id ?? ""),
                label: parentStudentLabel(child),
              }))}
            />
          </Field>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="À payer" value={formatFinanceAmount(amountDue, currency)} />
        <Metric label="Payé" value={formatFinanceAmount(amountPaid, currency)} />
        <Metric label="Reste" value={formatFinanceAmount(balance, currency)} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-black text-ink">Obligations</h2>
        </div>
        {fees.length ? (
          <div className="divide-y divide-line">
            {fees.map((fee) => (
              <div key={fee.id} className="grid gap-2 px-5 py-4 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:items-center">
                <div>
                  <p className="font-black text-ink">{fee.label}</p>
                  <p className="text-sm font-semibold text-muted">{fee.periodLabel || fee.academicYear}</p>
                </div>
                <p className="text-sm font-bold text-ink">{formatFinanceAmount(fee.amountDue, fee.currency)}</p>
                <p className="text-sm font-bold text-ink">{formatFinanceAmount(fee.balance, fee.currency)} restant</p>
                <div className="md:text-right">
                  <p className="text-sm font-black text-ink">{fee.status}</p>
                  <p className="text-xs font-semibold text-muted">{formatFinanceDate(fee.dueDate)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm font-semibold text-muted">Aucune obligation disponible.</p>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-black text-ink">Historique des paiements</h2>
        </div>
        {payments.length ? (
          <div className="divide-y divide-line">
            {payments.map((payment, index) => (
              <div key={String(payment.id ?? index)} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_1fr_1fr] md:items-center">
                <div>
                  <p className="font-black text-ink">{formatFinanceAmount(Number(payment.amount ?? payment.totalAmount ?? 0), String(payment.currency ?? currency))}</p>
                  <p className="text-xs font-semibold text-muted">{formatFinanceDate(String(payment.date ?? payment.paidAt ?? ""))}</p>
                </div>
                <p className="text-sm font-semibold text-muted">
                  {String(payment.method ?? payment.paymentMethod ?? "Mode non renseigné")}
                </p>
                <div className="md:text-right">
                  <p className="text-sm font-black text-ink">Reçu</p>
                  <p className="text-xs font-semibold text-muted">
                    {String(payment.receiptNumber ?? payment.receiptCode ?? payment.reference ?? payment.id ?? "—")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm font-semibold text-muted">Aucun paiement enregistré.</p>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-black uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-black text-ink">{value}</p>
    </Card>
  );
}
