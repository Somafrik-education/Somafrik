import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Modal } from "../ui/Modal";
import { Field, Input, Select } from "../ui/Field";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { getCurrentSchool, scopedStudents } from "../../lib/establishment";
import { formatMetric } from "../../lib/format";
import {
  collectStudentPaymentClasses,
  createPaymentLine,
  defaultPaymentDate,
  FEE_TYPES,
  PAYMENT_METHODS,
  paymentDateFromInput,
  paymentDateToInput,
  parseLineAmount,
  sumPaymentLines,
  validateMultiItemPaymentInput,
  type FeeType,
  type PaymentMethod,
  type PaymentRecord,
  type QuickPaymentLine,
  type StudentSearchResult,
  searchStudentsForPayment,
  resolveSchoolCurrency,
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
  const scopeUser = scopedUser ?? session?.user ?? null;

  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentSearchResult | null>(null);
  const [classId, setClassId] = useState("");
  const [lines, setLines] = useState<QuickPaymentLine[]>([createPaymentLine()]);
  const [method, setMethod] = useState<PaymentMethod>("Espèces");
  const [dateInput, setDateInput] = useState(paymentDateToInput(defaultPaymentDate()));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedPayment, setSavedPayment] = useState<PaymentRecord | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const students = useMemo(
    () => scopedStudents(scopeUser, state) as PaymentRecord[],
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

  const classOptions = useMemo(
    () => (selectedStudent ? collectStudentPaymentClasses(selectedStudent.id, students) : []),
    [selectedStudent, students],
  );
  const total = sumPaymentLines(lines);
  const currency = resolveSchoolCurrency(school);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedStudent(null);
    setClassId("");
    setLines([createPaymentLine()]);
    setMethod("Espèces");
    setDateInput(paymentDateToInput(defaultPaymentDate()));
    setComment("");
    setSavedPayment(null);
    setShowReceipt(false);
  }, [open]);

  function selectStudent(student: StudentSearchResult) {
    setSelectedStudent(student);
    setSearch(student.name);
    const options = collectStudentPaymentClasses(student.id, students);
    setClassId(options.length === 1 ? options[0].classId : "");
  }

  function updateLine(id: string, patch: Partial<QuickPaymentLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function removeLine(id: string) {
    setLines((current) => (current.length <= 1 ? current : current.filter((line) => line.id !== id)));
  }

  async function persistPayment(printAfter = false) {
    if (!selectedStudent) return;
    setBusy(true);
    try {
      const created = await financeApi.createPayment({
        studentId: selectedStudent.id,
        classId,
        items: lines.map((line) => ({
          feeType: line.feeType,
          feeLabel: line.feeType,
          amount: parseLineAmount(line.amount),
        })),
        paymentMethod: method,
        paidAt: paymentDateFromInput(dateInput),
        comment,
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
    const validationError = validateMultiItemPaymentInput({
      student: selectedStudent,
      classId,
      classOptions,
      method,
      date: paymentDateFromInput(dateInput),
      lines,
    });
    if (validationError) {
      showToast(validationError, "error");
      return;
    }
    await persistPayment(printAfter);
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
      title="Enregistrer le paiement"
      description="Un reçu unique pour plusieurs libellés."
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
            Enregistrer le paiement
          </Button>
        </div>
      }
    >
      <form className="space-y-5" onSubmit={(event) => void handleSubmit(event, false)}>
        <Field label="Élève *">
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (selectedStudent && event.target.value !== selectedStudent.name) {
                setSelectedStudent(null);
              }
            }}
            placeholder="Nom, matricule ou code élève"
            autoFocus
            data-testid="payment-student-search"
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
            <p className="mt-1 text-muted">Matricule : {selectedStudent.matricule}</p>
            <div className="mt-3">
              <Field label="Classe" required>
                <Select
                  value={classId}
                  onChange={(event) => setClassId(event.target.value)}
                  options={
                    classOptions.length
                      ? classOptions.map((item) => ({ value: item.classId, label: item.className }))
                      : [{ value: "", label: "Aucune inscription active" }]
                  }
                />
              </Field>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink">Libellés</p>
          {lines.map((line, index) => (
            <div
              key={line.id}
              className="grid gap-3 rounded-xl border border-line bg-slate-50 p-3 sm:grid-cols-[1fr_8rem_auto]"
              data-testid={`payment-line-${index}`}
            >
              <Field label="Type de frais / libellé">
                <Select
                  value={line.feeType}
                  onChange={(event) => updateLine(line.id, { feeType: event.target.value as FeeType })}
                  options={FEE_TYPES.map((value) => ({ value, label: value }))}
                />
              </Field>
              <Field label="Montant">
                <Input
                  type="number"
                  min={1}
                  step="0.01"
                  value={line.amount}
                  onChange={(event) => updateLine(line.id, { amount: event.target.value })}
                  placeholder="0"
                />
              </Field>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={lines.length <= 1}
                  onClick={() => removeLine(line.id)}
                  aria-label="Supprimer la ligne"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            data-testid="payment-add-line"
            onClick={() => setLines((current) => [...current, createPaymentLine("Frais d'examen")])}
          >
            <Plus className="mr-1 h-4 w-4" />
            Ajouter un libellé
          </Button>
        </div>

        <div className="rounded-xl border border-line bg-white px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-wide text-muted">Total</p>
          <p className="text-2xl font-black text-brand" data-testid="payment-total">
            {formatMetric(total, currency)}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode de paiement *">
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              options={PAYMENT_METHODS.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label="Date *">
            <Input type="date" value={dateInput} onChange={(event) => setDateInput(event.target.value)} />
          </Field>
        </div>

        <Field label="Commentaire">
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
          Un reçu · une référence · total recalculé côté serveur
        </p>
      </form>
    </Modal>
  );
}
