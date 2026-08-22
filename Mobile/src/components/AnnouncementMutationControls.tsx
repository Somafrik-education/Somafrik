import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { createClientsAnnouncement } from "../services/api";

export default function AnnouncementMutationControls({
  onChanged,
}: {
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "announcements");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  const submit = async () => {
    if (!title.trim() || !message.trim()) {
      setError("Titre et message obligatoires.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createClientsAnnouncement({
        title: title.trim(),
        message: message.trim(),
      });
      setOpen(false);
      setTitle("");
      setMessage("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publication impossible.");
    } finally {
      setSaving(false);
    }
  };

  if (!access.canCreate) return null;
  return (
    <>
      <TouchableOpacity
        style={styles.create}
        onPress={() => {
          setError("");
          setOpen(true);
        }}
        testID="announcements-create"
        accessibilityRole="button"
        accessibilityLabel="Nouvelle annonce"
      >
        <Text style={styles.createText}>Nouvelle annonce</Text>
      </TouchableOpacity>
      <CanonicalMutationModal
        visible={open}
        title="Nouvelle annonce"
        error={error}
        saving={saving}
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
      >
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Titre" editable={!saving} />
        <TextInput
          style={[styles.input, styles.area]}
          value={message}
          onChangeText={setMessage}
          placeholder="Message"
          multiline
          editable={!saving}
        />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  create: { minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
  input: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 12, marginBottom: 10, color: "#0F172A" },
  area: { minHeight: 100, textAlignVertical: "top" },
});
