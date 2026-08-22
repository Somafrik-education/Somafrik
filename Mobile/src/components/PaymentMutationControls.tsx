import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import ChoiceChips from "./ChoiceChips";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { createIntentionStore } from "../lib/mutationGuard";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { submitProtectedMutation } from "../lib/outbox";
import { createSchoolPayment } from "../services/api";

type StudentOption = { id: string; name?: string };

const PAYMENT_DRAFT_INTENTION = "payments-create-draft";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function PaymentMutationControls({
  students,
  onChanged,
}: {
  students: StudentOption[];
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "payments");
  const intentionsRef = useRef(createIntentionStore());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [feeType, setFeeType] = useState("Scolarité");
  const [method, setMethod] = useState("Espèces");
  const [draftDate, setDraftDate] = useState(todayIsoDate);

  const options = useMemo(
    () => students.map((item) => ({ id: item.id, label: item.name || item.id })),
    [students],
  );

  const openDraft = () => {
    intentionsRef.current.rotate(PAYMENT_DRAFT_INTENTION);
    setError("");
    setStudentId("");
    setAmount("");
    setFeeType("Scolarité");
    setMethod("Espèces");
    setDraftDate(todayIsoDate());
    setOpen(true);
  };

  const submit = async () => {
    const parsed = Number(amount);
    if (!studentId || !Number.isFinite(parsed) || parsed <= 0) {
      setError("Élève et montant positif obligatoires.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      studentId,
      method,
      date: draftDate,
      items: [{ feeType, amount: parsed }],
    };
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
        setError(submitted.outcome === "queued" ? "Paiement conservé en file. Pas de succès local." : "Enregistrement refusé.");
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
        <ChoiceChips label="Élève" options={options} selectedId={studentId} onSelect={setStudentId} disabled={saving} />
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="Montant" keyboardType="numeric" editable={!saving} />
        <ChoiceChips
          label="Type de frais"
          options={["Scolarité", "Inscription", "Cantine"].map((item) => ({ id: item, label: item }))}
          selectedId={feeType}
          onSelect={setFeeType}
          disabled={saving}
        />
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
  input: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 12, marginBottom: 10, color: "#0F172A" },
});
