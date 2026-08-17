import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Zap } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Modal } from "../ui/Modal";
import { Field, Input, Select } from "../ui/Field";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/ConfirmDialog";
import { getCurrentSchool, scopedPayments, scopedStudents } from "../../lib/establishment";
import { scopedStudentFees } from "../../lib/fees";
import { formatMetric } from "../../lib/format";
import {
  buildQuickPaymentRecord,
  computeFeeBalance,
  defaultPaymentDate,
  detectDuplicatePayment,
  FEE_TYPES,
  OVERPAYMENT_ACTIONS,
  PAYMENT_METHODS,
  paymentDateFromInput,
  paymentDateToInput,
  QUICK_AMOUNT_SHORTCUTS,
  resolveSchoolCurrency,
  resolveSchoolYear,
  searchStudentsForPayment,
  validateQuickPaymentInput,
  type FeeType,
  type PaymentMethod,
  type PaymentRecord,
  type StudentSearchResult,
} from "../../lib/quickPayment";
import { buildPaymentReceiptPrintPlan } from "../../pages/entity-page/paymentWorkflow";
import { financeApi } from "../../lib/financeApi";
import { PaymentReceipt } from "./PaymentReceipt";

interface QuickPaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (payment: PaymentRecord) => void;
}

export function QuickPaymentModal({ open, onClose, onSaved }: QuickPaymentModalProps) {
  const { session } = useAuth();
  const { state, update, refresh } = useData();
  const { activeSchoolCode: schoolCode, scopedUser } = useActiveSchool();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const scopeUser = scopedUser ?? session?.user ?? null;

  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentSearchResult | null>(null);
  const [feeType, setFeeType] = useState<FeeType>("Minerval / scolarité");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Espèces");
  const [dateInput, setDateInput] = useState(paymentDateToInput(defaultPaymentDate()));
  const [comment, setComment] = useState("");
  const [overpaymentAction, setOverpaymentAction] = useState<string>(OVERPAYMENT_ACTIONS[0]);
  const [busy, setBusy] = useState(false);
  const [savedPayment, setSavedPayment] = useState<PaymentRecord | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const students = useMemo(
    () => scopedStudents(scopeUser, state) as PaymentRecord[],
    [scopeUser, state],
  );
  const payments = useMemo(
    () => scopedPayments(scopeUser, state) as PaymentRecord[],
    [scopeUser, state],
  );
  const studentFees = useMemo(
    () => scopedStudentFees(scopeUser, state),
    [scopeUser, state],
  );
  const school = useMemo(
    () =>
      selectedStudent
        ? state.schools.find((item) => item.code === selectedStudent.schoolCode) ??
          getCurrentSchool(scopeUser, state)
        : getCurrentSchool(scopeUser, state),
    [selectedStudent, state.schools, scopeUser, state],
  );

  const searchResults = useMemo(
    () =>
      searchStudentsForPayment(
        search,
        students,
        state.schools,
        schoolCode && schoolCode !== "*" ? schoolCode : undefined,
      ),
    [search, students, state.schools, schoolCode],
  );

  const balance = useMemo(() => {
    if (!selectedStudent) return null;
    return computeFeeBalance(
      selectedStudent.id,
      feeType,
      payments,
      resolveSchoolCurrency(school),
      studentFees,
    );
  }, [selectedStudent, feeType, payments, school, studentFees]);

  const parsedAmount = Number(amount.replace(/\s/g, "").replace(",", "."));
  const overpayment =
    balance && Number.isFinite(parsedAmount) ? Math.max(0, parsedAmount - balance.remaining) : 0;

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedStudent(null);
    setFeeType("Minerval / scolarité");
    setAmount("");
    setMethod("Espèces");
    setDateInput(paymentDateToInput(defaultPaymentDate()));
    setComment("");
    setOverpaymentAction(OVERPAYMENT_ACTIONS[0]);
    setSavedPayment(null);
    setShowReceipt(false);
  }, [open]);

  function selectStudent(student: StudentSearchResult) {
    setSelectedStudent(student);
    setSearch(student.name);
  }

  async function persistPayment(_payment: PaymentRecord, printAfter = false) {
    setBusy(true);
    try {
      const created = await financeApi.createPayment({
        studentId: selectedStudent?.id,
        feeType,
        amount: parsedAmount,
        method,
        date: paymentDateFromInput(dateInput),
        comment,
        overpaymentAction: overpayment > 0 ? overpaymentAction : undefined,
      });
      await refresh();
      setSavedPayment(created as unknown as PaymentRecord);
      onSaved?.(created as unknown as PaymentRecord);
      showToast("Paiement enregistré", "success");
      if (printAfter) {
        setShowReceipt(true);
        window.setTimeout(() => window.print(), 300);
      } else {
        onClose();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'enregistrement du paiement", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent, printAfter = false) {
    event.preventDefault();
    if (!selectedStudent) {
      showToast("Veuillez sélectionner un élève", "error");
      return;
    }

    const input = {
      student: selectedStudent,
      feeType,
      amount: parsedAmount,
      method,
      date: paymentDateFromInput(dateInput),
      comment,
      overpaymentAction: overpayment > 0 ? overpaymentAction : undefined,
      schoolYear: resolveSchoolYear(state, selectedStudent.schoolCode),
    };

    const validationError = validateQuickPaymentInput(input);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    const duplicate = detectDuplicatePayment(input, payments, scopeUser?.id ?? scopeUser?.identifier);
    if (duplicate.duplicate) {
      const proceed = await confirm({
        title: "Doublon potentiel",
        description:
          "Un paiement similaire existe déjà pour cet élève (même montant, type de frais, date et mode). Confirmer l'enregistrement ?",
        confirmLabel: "Enregistrer quand même",
        tone: "danger",
      });
      if (!proceed) return;
    }

    if (overpayment > 0) {
      const proceed = await confirm({
        title: "Trop-perçu détecté",
        description: `Le montant dépasse le solde dû de ${formatMetric(overpayment, balance?.currency)}. Action : ${overpaymentAction}. Confirmer l'enregistrement ?`,
        confirmLabel: "Confirmer",
      });
      if (!proceed) return;
    }

    const payment = buildQuickPaymentRecord(input, {
      payments,
      studentFees,
      school,
      user: scopeUser,
      schoolYear: input.schoolYear ?? resolveSchoolYear(state, selectedStudent.schoolCode),
    });

    await persistPayment(payment, printAfter);
  }

  if (showReceipt && savedPayment) {
    return (
      <Modal
        open={open}
        title="Reçu de paiement"
        description="Paiement enregistré avec succès."
        onClose={() => {
          setShowReceipt(false);
          onClose();
        }}
        size="lg"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowReceipt(false);
                onClose();
              }}
            >
              Fermer
            </Button>
            <Button
              onClick={() => {
                const plan = buildPaymentReceiptPrintPlan(
                  { scopeUser, state },
                  { payment: savedPayment },
                );
                void update(plan.patch);
                window.print();
              }}
            >
              Imprimer
            </Button>
          </div>
        }
      >
        <PaymentReceipt payment={savedPayment} school={school} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="Saisie rapide paiement"
      description="Enregistrez un paiement scolaire en quelques secondes."
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={(event) => void handleSubmit(event, true)}
          >
            Enregistrer et imprimer
          </Button>
          <Button disabled={busy} onClick={(event) => void handleSubmit(event, false)}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <form className="space-y-5" onSubmit={(event) => void handleSubmit(event, false)}>
        <Field label="Rechercher élève" hint="Nom, matricule, téléphone parent ou code élève">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (selectedStudent && event.target.value !== selectedStudent.name) {
                setSelectedStudent(null);
              }
            }}
            placeholder="Ex. Mukendi, CD-IN-EL-26-001, +243..."
            autoFocus
          />
        </Field>

        {search.length >= 2 && !selectedStudent ? (
          <div className="max-h-44 overflow-y-auto rounded-xl border border-line bg-slate-50">
            {searchResults.length ? (
              searchResults.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  className="flex w-full flex-col items-start border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-white"
                  onClick={() => selectStudent(student)}
                >
                  <span className="font-semibold text-ink">{student.name}</span>
                  <span className="text-xs text-muted">
                    {student.className} · {student.matricule} · {student.schoolName}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-4 py-3 text-sm text-muted">Aucun élève trouvé</p>
            )}
          </div>
        ) : null}

        {selectedStudent ? (
          <div className="rounded-xl border border-brand/20 bg-brand-50/40 p-4 text-sm">
            <p className="font-bold text-ink">{selectedStudent.name}</p>
            <p className="mt-1 text-muted">
              Classe : {selectedStudent.className || "—"} · Matricule : {selectedStudent.matricule}
            </p>
            <p className="text-muted">Établissement : {selectedStudent.schoolName}</p>
            {balance ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-white px-3 py-2">
                  <p className="text-xs text-muted">Montant dû</p>
                  <p className="font-bold">{formatMetric(balance.amountDue, balance.currency)}</p>
                </div>
                <div className="rounded-lg bg-white px-3 py-2">
                  <p className="text-xs text-muted">Déjà payé</p>
                  <p className="font-bold">{formatMetric(balance.amountPaid, balance.currency)}</p>
                </div>
                <div className="rounded-lg bg-white px-3 py-2">
                  <p className="text-xs text-muted">Solde restant</p>
                  <p className="font-bold text-brand">{formatMetric(balance.remaining, balance.currency)}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type de frais">
            <Select
              value={feeType}
              onChange={(event) => setFeeType(event.target.value as FeeType)}
              options={FEE_TYPES.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label="Mode de paiement">
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              options={PAYMENT_METHODS.map((value) => ({ value, label: value }))}
            />
          </Field>
        </div>

        <Field label={`Montant payé (${resolveSchoolCurrency(school)})`}>
          <Input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Ex. 25000"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_AMOUNT_SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut}
                type="button"
                className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-brand/40 hover:text-brand"
                onClick={() => setAmount(String(shortcut))}
              >
                {formatMetric(shortcut)}
              </button>
            ))}
          </div>
        </Field>

        {overpayment > 0 ? (
          <Field label="Trop-perçu — action">
            <Select
              value={overpaymentAction}
              onChange={(event) => setOverpaymentAction(event.target.value)}
              options={OVERPAYMENT_ACTIONS.map((value) => ({ value, label: value }))}
            />
            <p className="mt-1 text-xs text-amber-700">
              Trop-perçu : {formatMetric(overpayment, balance?.currency)}
            </p>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date du paiement">
            <Input
              type="date"
              value={dateInput}
              onChange={(event) => setDateInput(event.target.value)}
            />
          </Field>
          <Field label="Année scolaire">
            <Input
              readOnly
              value={
                selectedStudent
                  ? resolveSchoolYear(state, selectedStudent.schoolCode)
                  : resolveSchoolYear(state, schoolCode ?? "")
              }
            />
          </Field>
        </div>

        <Field label="Commentaire (facultatif)">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Observations, numéro de transaction..."
            rows={2}
            className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </Field>

        <p className="flex items-center gap-2 text-xs text-muted">
          <Zap className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
          Saisie tracée · référence unique · notification interne au parent
        </p>
      </form>
    </Modal>
  );
}
