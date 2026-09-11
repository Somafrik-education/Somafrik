import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import ChoiceChips from "./ChoiceChips";
import FormField from "./FormField";
import { hasFieldErrors, trimField, validateFinancePaymentLinesDraft } from "../lib/formFieldValidation";
import { canRecordSchoolPayment } from "../lib/mobileCrudParity";
import { createIntentionStore } from "../lib/mutationGuard";
import { isOfflineContext } from "../lib/connectivity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  UNALLOCATED_TARGET,
  buildFinancePaymentWritePayload,
  collectActivePaymentClasses,
  collectOpenPaymentFees,
  formatPaymentStudentLabel,
  paymentSubmitErrorMessage,
  preselectPaymentClassId,
  preselectPaymentObligationId,
  resolvePaymentStudentSearchScope,
  searchPaymentStudents,
  type PaymentFeeRow,
  type PaymentStudent,
} from "../lib/paymentEnrollment";
import { formatFinanceAmount } from "../lib/financeCurrency";
import { financeObligationStatusLabel } from "../lib/financeObligationStatus";
import { createSchoolPayment } from "../services/api";

const PAYMENT_DRAFT_INTENTION = "payments-create-draft";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type DraftLine = { id: string; obligationId: string; amount: string };

export default function PaymentMutationControls({
  students,
  studentFees = [],
  onChanged,
  initialStudentId = "",
  paymentMethods,
  currency = "",
}: {
  students: PaymentStudent[];
  studentFees?: PaymentFeeRow[];
  onChanged: () => Promise<void> | void;
  initialStudentId?: string;
  paymentMethods?: string[];
  currency?: string;
}) {
  const { session } = useAuth();
  const canRecordPayment = canRecordSchoolPayment(session);
  const intentionsRef = useRef(createIntentionStore());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [studentId, setStudentId] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [classId, setClassId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { id: newLineId(), obligationId: UNALLOCATED_TARGET, amount: "" },
  ]);
  const amountRef = useRef<TextInput>(null);
  const [method, setMethod] = useState("");
  const [draftDate, setDraftDate] = useState(todayIsoDate);
  const resolvedMethod =
    paymentMethods && paymentMethods.length
      ? paymentMethods.includes(method)
        ? method
        : paymentMethods[0]
      : "";

  const studentOptions = useMemo(() => {
    const seen = new Set<string>();
    return students.flatMap((item) => {
      if (!item.id || seen.has(item.id)) return [];
      seen.add(item.id);
      return [item];
    });
  }, [students]);
  const selectedStudent = useMemo(
    () => studentOptions.find((item) => item.id === studentId) ?? null,
    [studentOptions, studentId],
  );
  const schoolScope = resolvePaymentStudentSearchScope(session);
  const searchResults = useMemo(
    () => (studentId ? [] : searchPaymentStudents(studentQuery, studentOptions, schoolScope)),
    [studentId, studentQuery, studentOptions, schoolScope],
  );

  const classOptions = useMemo(() => collectActivePaymentClasses(studentId, students), [studentId, students]);
  const feeOptions = useMemo(() => collectOpenPaymentFees(studentId, studentFees), [studentId, studentFees]);
  const obligationChips = useMemo(
    () => [
      { id: UNALLOCATED_TARGET, label: "Non imputé" },
      ...feeOptions.map((item) => ({
        id: item.obligationId,
        label: `${item.label} · reste ${formatFinanceAmount(item.balance, item.currency || currency)}`,
      })),
    ],
    [feeOptions, currency],
  );

  const applyStudent = (nextStudentId: string) => {
    setStudentId(nextStudentId);
    const next = studentOptions.find((item) => item.id === nextStudentId);
    setStudentQuery(next ? trimField(next.name) : "");
    setClassId(preselectPaymentClassId(nextStudentId, students));
    setLines([
      {
        id: newLineId(),
        obligationId: preselectPaymentObligationId(nextStudentId, studentFees),
        amount: "",
      },
    ]);
    setFieldErrors((current) => {
      const nextErrors = { ...current };
      delete nextErrors.studentId;
      delete nextErrors.classId;
      delete nextErrors.obligationId;
      return nextErrors;
    });
  };

  const openDraft = () => {
    intentionsRef.current.rotate(PAYMENT_DRAFT_INTENTION);
    setError("");
    setConfirmation("");
    setFieldErrors({});
    const nextStudentId = trimField(initialStudentId);
    setStudentId(nextStudentId);
    const next = students.find((item) => item.id === nextStudentId);
    setStudentQuery(next ? trimField(next.name) : "");
    setClassId(preselectPaymentClassId(nextStudentId, students));
    setLines([
      {
        id: newLineId(),
        obligationId: preselectPaymentObligationId(nextStudentId, studentFees),
        amount: "",
      },
    ]);
    setMethod(paymentMethods?.[0] ?? "");
    setDraftDate(todayIsoDate());
    setOpen(true);
  };

  const updateLine = (id: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const submit = async () => {
    if (saving) return;
    if (!paymentMethods?.length || !resolvedMethod || !paymentMethods.includes(resolvedMethod)) {
      setError("Catalogue des moyens de paiement indisponible.");
      return;
    }
    const nextErrors = validateFinancePaymentLinesDraft({
      studentId,
      classId,
      classOptions,
      lines,
      obligationOptions: feeOptions,
    });
    if (hasFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors);
      setError("");
      if (nextErrors.amount || nextErrors["amount-0"]) amountRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    const idempotencyKey = intentionsRef.current.getOrCreate(PAYMENT_DRAFT_INTENTION);
    try {
      const payload = buildFinancePaymentWritePayload({
        studentId,
        classId,
        method: resolvedMethod,
        date: draftDate,
        lines: lines.map((line) => {
          const selected = feeOptions.find((row) => row.obligationId === line.obligationId);
          return {
            obligationId: line.obligationId,
            amount: Number(trimField(line.amount).replace(",", ".")),
            feeType: selected?.feeType,
            label: selected?.label,
          };
        }),
      });
      if (isOfflineContext()) {
        setError(paymentSubmitErrorMessage("failed", new Error("Paiement hors connexion refusé. Aucune file Finance.")));
        return;
      }
      await createSchoolPayment(payload, { idempotencyKey });
      setOpen(false);
      setConfirmation("Encaissement enregistré. Les soldes ont été actualisés.");
      await onChanged();
      intentionsRef.current.rotate(PAYMENT_DRAFT_INTENTION);
    } catch (err) {
      setError(paymentSubmitErrorMessage("failed", err));
    } finally {
      setSaving(false);
    }
  };

  if (!canRecordPayment) return null;
  return (
    <>
      <TouchableOpacity
        style={styles.create}
        onPress={openDraft}
        testID="payments-create"
        accessibilityRole="button"
        accessibilityLabel="Enregistrer un encaissement"
      >
        <Text style={styles.createText}>Enregistrer un encaissement</Text>
      </TouchableOpacity>
      {confirmation ? (
        <Text style={styles.success} accessibilityRole="alert">
          {confirmation}
        </Text>
      ) : null}
      <CanonicalMutationModal
        visible={open}
        title="Enregistrer un encaissement"
        error={error}
        saving={saving}
        submitLabel={saving ? "Enregistrement…" : "Enregistrer"}
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
        submitDisabled={!paymentMethods?.length || !resolvedMethod || !studentId}
      >
        <FormField
          label="Élève"
          required
          type="search"
          value={studentQuery}
          onChangeText={(value) => {
            setStudentQuery(value);
            if (!selectedStudent) return;
            if (value !== trimField(selectedStudent.name)) {
              applyStudent("");
              setStudentQuery(value);
            }
          }}
          placeholder="Nom, matricule ou code élève"
          helperText="Saisissez au moins 2 caractères pour retrouver un élève inscrit."
          error={fieldErrors.studentId}
          editable={!saving}
          testID="payment-student-search"
        />
        {studentQuery.trim().length >= 2 && !studentId ? (
          <View style={styles.resultsBox}>
            {searchResults.length ? (
              searchResults.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.resultRow}
                  onPress={() => applyStudent(item.id)}
                  disabled={saving}
                  testID={`payment-student-option-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={formatPaymentStudentLabel(item)}
                >
                  <Text style={styles.resultName}>{item.name || item.id}</Text>
                  <Text style={styles.resultMeta}>
                    {[item.className, item.studentCode].filter(Boolean).join(" · ")}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.openEmpty}>Aucun élève trouvé</Text>
            )}
          </View>
        ) : null}
        {selectedStudent ? (
          <View style={styles.selectedBox} testID="payment-selected-student">
            <Text style={styles.selectedName}>{selectedStudent.name || selectedStudent.id}</Text>
            {selectedStudent.studentCode ? (
              <Text style={styles.selectedMeta}>Matricule : {selectedStudent.studentCode}</Text>
            ) : null}
            {selectedStudent.className ? (
              <Text style={styles.selectedMeta}>{selectedStudent.className}</Text>
            ) : null}
          </View>
        ) : null}
        <ChoiceChips
          label="Classe"
          required
          options={classOptions.map((item) => ({ id: item.classId, label: item.className }))}
          selectedId={classId}
          onSelect={(id) => {
            setClassId(id);
            setFieldErrors((current) => {
              if (!current.classId) return current;
              const next = { ...current };
              delete next.classId;
              return next;
            });
          }}
          disabled={saving || !studentId}
          error={fieldErrors.classId}
        />
        {studentId ? (
          <View style={styles.openBox}>
            <Text style={styles.openTitle}>Frais encore dus</Text>
            {feeOptions.length ? (
              feeOptions.map((item) => (
                <Text key={item.obligationId} style={styles.openRow}>
                  {item.label} · {financeObligationStatusLabel(item.status || "À payer")} · reste{" "}
                  {formatFinanceAmount(item.balance, item.currency || currency)}
                </Text>
              ))
            ) : (
              <Text style={styles.openEmpty}>
                Aucune obligation ouverte. Le montant saisi sera enregistré en non imputé.
              </Text>
            )}
          </View>
        ) : null}
        {lines.map((line, index) => (
          <View key={line.id} testID={`payment-line-${index}`}>
            <ChoiceChips
              label="Frais concerné"
              required
              options={obligationChips}
              selectedId={line.obligationId}
              onSelect={(id) => updateLine(line.id, { obligationId: id })}
              disabled={saving || !studentId}
              error={fieldErrors.obligationId || fieldErrors[`obligationId-${index}`]}
            />
            <FormField
              ref={index === 0 ? amountRef : undefined}
              label="Montant à encaisser"
              required
              type="amount"
              value={line.amount}
              onChangeText={(value) => updateLine(line.id, { amount: value })}
              placeholder="Ex. 25000"
              error={fieldErrors.amount || fieldErrors[`amount-${index}`]}
              editable={!saving}
            />
            {lines.length > 1 ? (
              <TouchableOpacity
                style={styles.removeLine}
                onPress={() => setLines((current) => current.filter((row) => row.id !== line.id))}
                accessibilityRole="button"
                accessibilityLabel="Supprimer la ligne"
              >
                <Text style={styles.removeLineText}>Retirer cette ligne</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        <TouchableOpacity
          style={styles.addLine}
          onPress={() =>
            setLines((current) => [
              ...current,
              { id: newLineId(), obligationId: UNALLOCATED_TARGET, amount: "" },
            ])
          }
          disabled={saving}
          testID="payment-add-line"
          accessibilityRole="button"
          accessibilityLabel="Ajouter une ligne"
        >
          <Text style={styles.addLineText}>Ajouter une ligne</Text>
        </TouchableOpacity>
        <ChoiceChips
          label="Moyen de paiement"
          options={(paymentMethods ?? []).map((item) => ({
            id: item,
            label: item,
          }))}
          selectedId={resolvedMethod}
          onSelect={setMethod}
          disabled={saving || !(paymentMethods && paymentMethods.length)}
          error={
            paymentMethods && paymentMethods.length
              ? undefined
              : "Catalogue des moyens de paiement indisponible."
          }
        />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  create: { minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
  success: {
    color: "#166534",
    fontWeight: "800",
    marginBottom: 12,
    backgroundColor: "#DCFCE7",
    borderRadius: 12,
    padding: 12,
  },
  openBox: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#F8FAFC",
  },
  openTitle: { color: "#0F172A", fontWeight: "800", marginBottom: 6 },
  openRow: { color: "#334155", fontWeight: "700", marginBottom: 4 },
  openEmpty: { color: "#64748B", fontWeight: "700" },
  resultsBox: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: "#F8FAFC",
    overflow: "hidden",
  },
  resultRow: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  resultName: { color: "#0F172A", fontWeight: "800" },
  resultMeta: { color: "#64748B", fontWeight: "700", marginTop: 2, fontSize: 12 },
  selectedBox: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#EFF6FF",
  },
  selectedName: { color: "#0F172A", fontWeight: "800" },
  selectedMeta: { color: "#475569", fontWeight: "700", marginTop: 4 },
  addLine: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  addLineText: { color: "#0F172A", fontWeight: "800" },
  removeLine: { minHeight: MIN_TOUCH_TARGET_DP, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  removeLineText: { color: "#B91C1C", fontWeight: "700" },
});
