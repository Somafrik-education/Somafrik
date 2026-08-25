import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import ChoiceChips from "./ChoiceChips";
import FormField from "./FormField";
import { hasFieldErrors, trimField, validatePaymentDraft } from "../lib/formFieldValidation";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { createIntentionStore } from "../lib/mutationGuard";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { submitProtectedMutation } from "../lib/outbox";
import {
  buildSchoolPaymentPayload,
  collectActivePaymentClasses,
  collectOpenPaymentFees,
  paymentSubmitErrorMessage,
  preselectPaymentClassId,
  preselectPaymentObligationId,
  type PaymentFeeRow,
  type PaymentStudent,
} from "../lib/paymentEnrollment";
import { createSchoolPayment } from "../services/api";

const PAYMENT_DRAFT_INTENTION = "payments-create-draft";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function PaymentMutationControls({
  students,
  studentFees = [],
  onChanged,
  initialStudentId = "",
}: {
  students: PaymentStudent[];
  studentFees?: PaymentFeeRow[];
  onChanged: () => Promise<void> | void;
  initialStudentId?: string;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "payments");
  const intentionsRef = useRef(createIntentionStore());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [studentId, setStudentId] = useState("");
  const [classId, setClassId] = useState("");
  const [obligationId, setObligationId] = useState("");
  const [amount, setAmount] = useState("");
  const amountRef = useRef<TextInput>(null);
  const [method, setMethod] = useState("Espèces");
  const [draftDate, setDraftDate] = useState(todayIsoDate);

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
  const selectedFee = feeOptions.find((row) => row.obligationId === obligationId);

  const applyStudent = (nextStudentId: string) => {
    setStudentId(nextStudentId);
    setClassId(preselectPaymentClassId(nextStudentId, students));
    setObligationId(preselectPaymentObligationId(nextStudentId, studentFees));
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
    setFieldErrors({});
    const nextStudentId = trimField(initialStudentId);
    setStudentId(nextStudentId);
    setClassId(preselectPaymentClassId(nextStudentId, students));
    setObligationId(preselectPaymentObligationId(nextStudentId, studentFees));
    setAmount("");
    setMethod("Espèces");
    setDraftDate(todayIsoDate());
    setOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    const nextErrors = validatePaymentDraft({
      studentId,
      amount,
      classId,
      classOptions,
      obligationId,
      obligationOptions: feeOptions,
    });
    if (hasFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors);
      setError("");
      if (nextErrors.amount) amountRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    const parsed = Number(trimField(amount).replace(",", "."));
    const payload = buildSchoolPaymentPayload({
      studentId,
      classId,
      amount: parsed,
      feeType: selectedFee?.feeType || "Acompte",
      obligationId: selectedFee?.obligationId,
      schoolFeeItemId: selectedFee?.schoolFeeItemId,
      method,
      date: draftDate,
    });
    const idempotencyKey = intentionsRef.current.getOrCreate(PAYMENT_DRAFT_INTENTION);
    try {
      const submitted = await submitProtectedMutation({
        domain: "payments",
        method: "POST",
        path: "/payments",
        payload,
        idempotencyKey,
        userId: String(session?.user.id ?? ""),
        schoolScope: String(session?.school?.code ?? session?.user.schoolCode ?? ""),
        persistOutbox: true,
        request: () => createSchoolPayment(payload, { idempotencyKey }),
      });
      if (submitted.outcome !== "confirmed") {
        setError(paymentSubmitErrorMessage(submitted.outcome, submitted.error));
        return;
      }
      setOpen(false);
      await onChanged();
      intentionsRef.current.rotate(PAYMENT_DRAFT_INTENTION);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  if (!access.canCreate) return null;
  return (
    <>
      <TouchableOpacity style={styles.create} onPress={openDraft} testID="payments-create" accessibilityRole="button" accessibilityLabel="Saisir un paiement">
        <Text style={styles.createText}>Saisir un paiement</Text>
      </TouchableOpacity>
      <CanonicalMutationModal
        visible={open}
        title="Saisir un paiement"
        error={error}
        saving={saving}
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
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
        <FormField
          ref={amountRef}
          label="Montant"
          required
          type="amount"
          value={amount}
          onChangeText={(value) => {
            setAmount(value);
            setFieldErrors((current) => {
              if (!current.amount) return current;
              const next = { ...current };
              delete next.amount;
              return next;
            });
          }}
          placeholder="Ex. 25000"
          error={fieldErrors.amount}
          editable={!saving}
        />
        {feeOptions.length ? (
          <ChoiceChips
            label="Frais"
            required
            options={feeOptions.map((item) => ({
              id: item.obligationId,
              label: `${item.label} · ${item.balance.toLocaleString("fr-FR")} FC`,
            }))}
            selectedId={obligationId}
            onSelect={(id) => {
              setObligationId(id);
              setFieldErrors((current) => {
                if (!current.obligationId) return current;
                const next = { ...current };
                delete next.obligationId;
                return next;
              });
            }}
            disabled={saving || !studentId}
            error={fieldErrors.obligationId}
          />
        ) : (
          <Text style={styles.hint}>Aucune dette ouverte — le reçu sera non imputé.</Text>
        )}
        <ChoiceChips
          label="Moyen"
          options={["Espèces", "Mobile Money", "Virement"].map((item) => ({ id: item, label: item }))}
          selectedId={method}
          onSelect={setMethod}
          disabled={saving}
        />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  create: { minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
  hint: { color: "#64748B", fontWeight: "700", marginBottom: 12 },
});
