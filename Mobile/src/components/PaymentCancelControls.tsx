import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import FormField from "./FormField";
import { paymentReference, paymentStatusLabel, type CanonicalPayment } from "../lib/dataTruth";
import { canCancelSchoolPayment } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { cancelSchoolPayment } from "../services/api";

function isCancelledPayment(payment: CanonicalPayment): boolean {
  return /cancel|annul/i.test(String(payment.status ?? ""));
}

function paymentCancelId(payment: CanonicalPayment): string {
  return paymentReference(payment) || String(payment.id ?? "").trim();
}

export default function PaymentCancelControls({
  payment,
  onChanged,
}: {
  payment: CanonicalPayment;
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");

  if (!canCancelSchoolPayment(session) || isCancelledPayment(payment)) return null;

  const submit = async () => {
    if (saving) return;
    const motif = reason.trim();
    if (!motif) {
      setError("Le motif d'annulation est obligatoire.");
      return;
    }
    const paymentId = paymentCancelId(payment);
    if (!paymentId) {
      setError("Référence de paiement manquante. Aucun succès local.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await cancelSchoolPayment(paymentId, motif);
      setOpen(false);
      setReason("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Annulation impossible.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.cancel}
        onPress={() => {
          setError("");
          setReason("");
          setOpen(true);
        }}
        testID={`payments-cancel-${paymentCancelId(payment)}`}
        accessibilityRole="button"
        accessibilityLabel={`Annuler le paiement ${paymentCancelId(payment)}`}
      >
        <Text style={styles.cancelText}>Annuler le paiement</Text>
      </TouchableOpacity>
      <CanonicalMutationModal
        visible={open}
        title="Annuler le paiement"
        error={error}
        saving={saving}
        submitLabel="Confirmer"
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
      >
        <Text style={styles.hint}>
          {paymentStatusLabel(payment.status)} · {paymentCancelId(payment)}. L'annulation part vers le serveur ; aucun succès local.
        </Text>
        <FormField
          label="Motif"
          required
          value={reason}
          onChangeText={setReason}
          placeholder="Ex. saisie erronée"
          editable={!saving}
        />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  cancel: {
    minHeight: MIN_TOUCH_TARGET_DP,
    marginTop: 8,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  cancelText: { color: "#B91C1C", fontWeight: "800" },
  hint: { color: "#64748B", fontWeight: "700", marginBottom: 12 },
});
