import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import ChoiceChips from "./ChoiceChips";
import FormField from "./FormField";
import { hasFieldErrors, trimField, validateFinancePaymentLinesDraft } from "../lib/formFieldValidation";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { createIntentionStore } from "../lib/mutationGuard";
import { isOfflineContext } from "../lib/connectivity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  UNALLOCATED_TARGET,
  buildFinancePaymentWritePayload,
  collectActivePaymentClasses,
  collectOpenPaymentFees,
  paymentSubmitErrorMessage,
  preselectPaymentClassId,
  preselectPaymentObligationId,
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
  const access = resolveEntityCrudAccess(session, "payments");
  const intentionsRef = useRef(createIntentionStore());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [studentId, setStudentId] = useState("");
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
      return [{ id: item.id, label: item.name || item.id }];
    });
  }, [students]);

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
    setClassId(preselectPaymentClassId(nextStudentId, students));
    setLines([
      {
        id: newLineId(),
        obligationId: preselectPaymentObligationId(nextStudentId, studentFees),
        amount: "",
      },
    ]);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.studentId;
      delete next.classId;
      delete next.obligationId;
      return next;
    });
  };

  const openDraft = () => {
    intentionsRef.current.rotate(PAYMENT_DRAFT_INTENTION);
    setError("");
    setConfirmation("");
    setFieldErrors({});
    const nextStudentId = trimField(initialStudentId);
    setStudentId(nextStudentId);
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

  if (!access.canCreate) return null;
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
        submitDisabled={!paymentMethods?.length || !resolvedMethod}
      >
        <ChoiceChips
          label="Élève"
          required
          options={studentOptions}
          selectedId={studentId}
          onSelect={applyStudent}
          disabled={saving}
          error={fieldErrors.studentId}
        />
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
