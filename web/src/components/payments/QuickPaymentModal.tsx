import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { Modal } from "../ui/Modal";
import { Field, Input, Select } from "../ui/Field";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { getCurrentSchool } from "../../lib/establishment";
import { formatFinanceAmount, resolveFinanceCurrency } from "../../lib/financeCurrency";
import {
  collectStudentPaymentClasses,
  createPaymentLine,
  defaultPaymentDate,
  paymentDateFromInput,
  paymentDateToInput,
  parseLineAmount,
  searchStudentsForPayment,
  sumPaymentLines,
  validateMultiItemPaymentInput,
  type PaymentRecord,
  type QuickPaymentLine,
  type StudentSearchResult,
} from "../../lib/quickPayment";
import { buildPaymentReceiptPrintPlan } from "../../pages/entity-page/paymentWorkflow";
import { financeApi } from "../../lib/financeApi";
import { createFinanceIdempotencyKey } from "../../lib/financeIdempotency";
import {
  UNALLOCATED_FEE_TYPE,
  UNALLOCATED_TARGET,
  OPEN_OBLIGATION_RESOLVE_ERROR,
  buildFinancePaymentWritePayload,
  collectOpenObligationsFromProjection,
  draftLineCash,
  findFinanceStudentOption,
  presentPaymentCashFromProjection,
  type FinanceObligationProjection,
  type FinanceStudentIdentity,
} from "../../lib/financePaymentWrite";
import { PaymentReceipt } from "./PaymentReceipt";
import { OpenObligationCards } from "./OpenObligationCards";

interface QuickPaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (payment: PaymentRecord) => void;
  /** Préselectionne l'élève après chargement du catalogue (Impayés → encaissement). */
  initialStudentId?: string;
  /**
   * Parcours Impayés : élève déjà connu, pas de recherche manuelle.
   * Le mode par défaut (Paiements) reste inchangé.
   */
  mode?: "default" | "quick-student";
  unpaidRemaining?: number;
  unpaidFeeIds?: string[];
}

function studentIdentityFromSearch(student: StudentSearchResult): FinanceStudentIdentity {
  return {
    id: student.id,
    studentId: student.id,
    studentCode: student.matricule,
    matricule: student.matricule,
    publicId: student.matricule,
  };
}

function studentSearchResultFromOption(
  row: PaymentRecord,
  schools: Array<{ code?: string; name?: string }>,
): StudentSearchResult {
  const code = String(row.schoolCode ?? "");
  const school = schools.find(
    (item) => String(item.code ?? "").trim().toUpperCase() === code.trim().toUpperCase(),
  );
  return {
    id: String(row.id ?? row.studentId ?? ""),
    name: String(row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()),
    matricule: String(row.matricule ?? row.studentCode ?? row.publicId ?? row.id ?? row.studentId ?? ""),
    classId: String(row.classId ?? "").trim() || undefined,
    classCode: String(row.classCode ?? "").trim() || undefined,
    className: String(row.className ?? ""),
    schoolCode: code,
    schoolName: String(school?.name ?? code),
    parentPhone: "",
    parentEmail: "",
  };
}

export function QuickPaymentModal({
  open,
  onClose,
  onSaved,
  initialStudentId,
  mode = "default",
  unpaidRemaining,
  unpaidFeeIds,
}: QuickPaymentModalProps) {
  const { session } = useAuth();
  const { state, update, refresh } = useData();
  const { activeSchoolCode: schoolCode, scopedUser } = useActiveSchool();
  const { showToast } = useToast();
  const scopeUser = scopedUser ?? session?.user ?? null;

  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentSearchResult | null>(null);
  const [classId, setClassId] = useState("");
  const [lines, setLines] = useState<QuickPaymentLine[]>([createPaymentLine(UNALLOCATED_TARGET)]);
  const [method, setMethod] = useState("");
  const [dateInput, setDateInput] = useState(paymentDateToInput(defaultPaymentDate()));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const paymentIntentionRef = useRef(createFinanceIdempotencyKey());
  const [savedPayment, setSavedPayment] = useState<PaymentRecord | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [optionStudents, setOptionStudents] = useState<PaymentRecord[]>([]);
  const [catalogMethods, setCatalogMethods] = useState<string[]>([]);
  const [catalogCurrency, setCatalogCurrency] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [studentFees, setStudentFees] = useState<FinanceObligationProjection[]>([]);

  const students = useMemo(
    () => (optionStudents.length ? optionStudents : []),
    [optionStudents],
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
  const studentIdentity = selectedStudent ? studentIdentityFromSearch(selectedStudent) : null;
  const openObligations = useMemo(
    () => (studentIdentity ? collectOpenObligationsFromProjection(studentIdentity, studentFees) : []),
    [studentIdentity, studentFees],
  );
  const isQuickStudent = mode === "quick-student";
  const unpaidHasOpenBalance = Number(unpaidRemaining) > 0 || (unpaidFeeIds?.length ?? 0) > 0;
  const obligationResolveError =
    isQuickStudent &&
    Boolean(selectedStudent) &&
    !catalogLoading &&
    openObligations.length === 0 &&
    unpaidHasOpenBalance;
  const obligationSelectOptions = useMemo(() => {
    const obligationOptions = openObligations.map((row) => ({
      value: row.obligationId,
      label: `${row.label}${row.periodLabel ? ` · ${row.periodLabel}` : ""} · reste ${formatFinanceAmount(row.balance, row.currency || catalogCurrency)}`,
    }));
    if (!isQuickStudent) {
      return [{ value: UNALLOCATED_TARGET, label: UNALLOCATED_FEE_TYPE }, ...obligationOptions];
    }
    if (obligationResolveError) return [];
    if (openObligations.length > 1) {
      return [{ value: "", label: "Sélectionner un frais" }, ...obligationOptions];
    }
    return obligationOptions;
  }, [openObligations, catalogCurrency, isQuickStudent, obligationResolveError]);
  const draftCash = draftLineCash(lines);
  const total = sumPaymentLines(lines);
  const currency = resolveFinanceCurrency(catalogCurrency, school?.currency);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedStudent(null);
    setClassId("");
    setLines([createPaymentLine(UNALLOCATED_TARGET)]);
    setMethod("");
    setDateInput(paymentDateToInput(defaultPaymentDate()));
    setComment("");
    setSavedPayment(null);
    setShowReceipt(false);
    setCatalogError("");
    setCatalogLoading(true);
    void (async () => {
      try {
        const [options, catalog, fees] = await Promise.all([
          financeApi.listPaymentStudentOptions(),
          financeApi.getFinanceCatalog(),
          financeApi.listStudentFees(),
        ]);
        const rows = Array.isArray(options) ? options : [];
        const flattened: PaymentRecord[] = [];
        for (const option of rows) {
          const classes = option.classes?.length
            ? option.classes
            : option.classId
              ? [{ classId: option.classId, classCode: option.classCode, className: option.className }]
              : [];
          for (const klass of classes) {
            flattened.push({
              id: option.studentId,
              studentId: option.studentId,
              firstName: option.firstName,
              lastName: option.lastName,
              name: `${option.firstName} ${option.lastName}`.trim(),
              matricule: option.studentCode,
              studentCode: option.studentCode,
              publicId: option.studentCode,
              classId: klass.classId,
              classCode: klass.classCode,
              className: klass.className,
              schoolCode: schoolCode && schoolCode !== "*" ? schoolCode : option.studentCode.slice(0, 11),
            });
          }
        }
        setOptionStudents(flattened);
        setStudentFees(Array.isArray(fees) ? fees : []);
        const activeMethods = (catalog.paymentMethods ?? []).filter((row) => row.active).map((row) => row.label);
        if (!activeMethods.length) {
          setCatalogMethods([]);
          setMethod("");
          setCatalogError("Aucun moyen de paiement actif pour cet établissement.");
          if (catalog.currency) setCatalogCurrency(catalog.currency);
          return;
        }
        setCatalogMethods(activeMethods);
        setMethod(activeMethods[0]);
        if (catalog.currency) setCatalogCurrency(catalog.currency);

        const wanted = String(initialStudentId ?? "").trim();
        if (wanted) {
          const match = findFinanceStudentOption(flattened, wanted);
          if (match) {
            applySelectedStudent(
              studentSearchResultFromOption(match, state.schools),
              flattened,
              Array.isArray(fees) ? fees : [],
            );
          }
        }
      } catch (cause) {
        setCatalogError(cause instanceof Error ? cause.message : "Catalogue financier indisponible.");
        setOptionStudents([]);
        setCatalogMethods([]);
        setCatalogCurrency("");
        setStudentFees([]);
      } finally {
        setCatalogLoading(false);
      }
    })();
  }, [open, schoolCode, initialStudentId]);

  function applySelectedStudent(
    student: StudentSearchResult,
    roster: PaymentRecord[],
    fees: FinanceObligationProjection[],
  ) {
    setSelectedStudent(student);
    setSearch(student.name);
    const options = collectStudentPaymentClasses(student.id, roster);
    setClassId(options.length === 1 ? options[0].classId : "");
    const openRows = collectOpenObligationsFromProjection(studentIdentityFromSearch(student), fees);
    if (openRows.length === 1) {
      setLines([createPaymentLine(openRows[0].obligationId)]);
      return;
    }
    if (mode === "quick-student") {
      setLines([createPaymentLine("")]);
      return;
    }
    setLines([createPaymentLine(UNALLOCATED_TARGET)]);
  }

  function selectStudent(student: StudentSearchResult) {
    applySelectedStudent(student, students, studentFees);
  }

  function updateLine(id: string, patch: Partial<QuickPaymentLine>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function removeLine(id: string) {
    setLines((current) => (current.length <= 1 ? current : current.filter((line) => line.id !== id)));
  }

  async function persistPayment(printAfter = false) {
    if (!selectedStudent || busyRef.current) return;
    if (mode === "quick-student" && (obligationResolveError || (openObligations.length === 0 && unpaidHasOpenBalance))) {
      showToast(OPEN_OBLIGATION_RESOLVE_ERROR, "error");
      return;
    }
    if (
      mode === "quick-student" &&
      unpaidHasOpenBalance &&
      lines.some((line) => String(line.obligationId ?? "").trim() === UNALLOCATED_TARGET) &&
      openObligations.length === 0
    ) {
      showToast(OPEN_OBLIGATION_RESOLVE_ERROR, "error");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const payload = buildFinancePaymentWritePayload({
        studentId: selectedStudent.id,
        classId,
        paymentMethod: method,
        paidAt: paymentDateFromInput(dateInput),
        comment,
        lines: lines.map((line) => {
          const obligation = openObligations.find((row) => row.obligationId === line.obligationId);
          return {
            obligationId: line.obligationId,
            amount: parseLineAmount(line.amount),
            feeType: obligation?.feeType,
            label: obligation?.label,
          };
        }),
      });
      const created = await financeApi.createPayment(payload, {
        idempotencyKey: paymentIntentionRef.current,
      });
      paymentIntentionRef.current = createFinanceIdempotencyKey();
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
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent, printAfter = false) {
    event.preventDefault();
    if (busyRef.current) return;
    if (catalogError || !catalogMethods.length) {
      showToast(catalogError || "Catalogue financier indisponible.", "error");
      return;
    }
    if (mode === "quick-student" && obligationResolveError) {
      showToast(OPEN_OBLIGATION_RESOLVE_ERROR, "error");
      return;
    }
    if (!catalogMethods.includes(method)) {
      showToast("Moyen de paiement non autorisé pour cet établissement.", "error");
      return;
    }
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
    const cash = presentPaymentCashFromProjection(savedPayment as { amount?: number; allocatedAmount?: number; unallocatedAmount?: number });
    return (
      <Modal
        open={open}
        title="Reçu de paiement"
        description={`Montant reçu ${formatFinanceAmount(cash.received, currency)} · imputé ${formatFinanceAmount(cash.allocated, currency)} · non imputé ${formatFinanceAmount(cash.unallocated, currency)}`}
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
      title="Enregistrer un encaissement"
      description="Choisissez l'élève, ses frais ouverts, puis le montant. L'affectation suit le serveur."
      onClose={onClose}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="secondary"
            disabled={busy || catalogLoading || Boolean(catalogError) || !catalogMethods.length || obligationResolveError}
            onClick={(event) => void handleSubmit(event, true)}
          >
            {busy ? "Enregistrement…" : "Enregistrer et imprimer"}
          </Button>
          <Button
            disabled={busy || catalogLoading || Boolean(catalogError) || !catalogMethods.length || obligationResolveError}
            onClick={(event) => void handleSubmit(event, false)}
          >
            {busy ? "Enregistrement…" : "Enregistrer l'encaissement"}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-5"
        aria-busy={busy || catalogLoading}
        data-testid="quick-payment-modal"
        onSubmit={(event) => void handleSubmit(event, false)}
      >
        {catalogLoading ? (
          <p className="rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-muted" role="status">
            Chargement du catalogue financier…
          </p>
        ) : null}
        {catalogError ? (
          <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
            {catalogError}
          </p>
        ) : null}
        {isQuickStudent ? null : (
          <>
            <Field label="Élève" required>
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
                aria-describedby="payment-student-help"
                data-testid="payment-student-search"
              />
            </Field>
            <p id="payment-student-help" className="text-xs text-muted">
              Saisissez au moins 2 caractères pour retrouver un élève inscrit.
            </p>

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
          </>
        )}

        {selectedStudent && !isQuickStudent ? (
          <div
            className="rounded-xl border border-brand/20 bg-brand-50/40 p-4 text-sm"
            data-testid="quick-payment-selected-student"
          >
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

        {selectedStudent && isQuickStudent ? (
          <div
            className="rounded-xl border border-brand/20 bg-brand-50/40 p-4 text-sm"
            data-testid="quick-payment-selected-student"
          >
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Nom</dt>
                <dd className="mt-1 font-bold text-ink">{selectedStudent.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Matricule</dt>
                <dd className="mt-1 font-semibold text-ink">{selectedStudent.matricule}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Classe</dt>
                <dd className="mt-1">
                  {classOptions.length <= 1 ? (
                    <span className="font-semibold text-ink">
                      {classOptions[0]?.className || selectedStudent.className || "—"}
                    </span>
                  ) : (
                    <Select
                      value={classId}
                      onChange={(event) => setClassId(event.target.value)}
                      options={classOptions.map((item) => ({ value: item.classId, label: item.className }))}
                    />
                  )}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        {selectedStudent ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-ink">Frais encore dus</p>
            {obligationResolveError ? (
              <p
                className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
                role="alert"
                data-testid="quick-payment-obligation-mismatch"
              >
                {OPEN_OBLIGATION_RESOLVE_ERROR}
              </p>
            ) : (
              <OpenObligationCards
                currency={currency}
                obligations={openObligations.map((row) => ({
                  obligationId: row.obligationId,
                  label: row.label,
                  periodLabel: row.periodLabel,
                  className: row.className,
                  balance: row.balance,
                  amountDue: row.amountDue,
                  amountPaid: row.amountPaid,
                  dueDate: row.dueDate,
                  status: row.status,
                  currency: row.currency || currency,
                }))}
              />
            )}
          </div>
        ) : null}

        {obligationResolveError ? null : (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-ink">Affectation de l'encaissement</p>
            {lines.map((line, index) => (
              <div
                key={line.id}
                className="grid gap-3 rounded-xl border border-line bg-slate-50 p-3 sm:grid-cols-[1fr_8rem_auto]"
                data-testid={`payment-line-${index}`}
              >
                <Field label="Frais concerné" required>
                  <Select
                    value={line.obligationId}
                    onChange={(event) => updateLine(line.id, { obligationId: event.target.value })}
                    options={obligationSelectOptions}
                  />
                </Field>
                <Field label="Montant à encaisser" required>
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
            {isQuickStudent ? null : (
              <Button
                type="button"
                variant="secondary"
                data-testid="payment-add-line"
                disabled={Boolean(catalogError)}
                onClick={() =>
                  setLines((current) => [...current, createPaymentLine(UNALLOCATED_TARGET)])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Ajouter une ligne de frais
              </Button>
            )}
          </div>
        )}

        <div className="rounded-xl border border-line bg-white px-4 py-3">
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Montant reçu</p>
              <p className="font-black text-ink" data-testid="payment-received">
                {formatFinanceAmount(draftCash.received, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Montant imputé</p>
              <p className="font-black text-ink" data-testid="payment-allocated">
                {formatFinanceAmount(draftCash.allocated, currency)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Montant non imputé</p>
              <p className="font-black text-brand" data-testid="payment-unallocated">
                {formatFinanceAmount(draftCash.unallocated, currency)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-right text-xs uppercase tracking-wide text-muted">Total</p>
          <p className="text-right text-2xl font-black text-brand" data-testid="payment-total">
            {formatFinanceAmount(total, currency)}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode de paiement" required>
            <Select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              options={catalogMethods.map((value) => ({ value, label: value }))}
            />
          </Field>
          <Field label="Date d'encaissement" required>
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
          Un reçu est disponible après enregistrement. Les soldes affichés viennent du serveur.
        </p>
      </form>
    </Modal>
  );
}
