import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import FormField from "./FormField";
import { hasFieldErrors, trimField, validateAnnouncementDraft } from "../lib/formFieldValidation";
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const titleRef = useRef<TextInput>(null);
  const messageRef = useRef<TextInput>(null);

  const submit = async () => {
    if (saving) return;
    const nextErrors = validateAnnouncementDraft({ title, message });
    if (hasFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors);
      setError("");
      if (nextErrors.title) titleRef.current?.focus();
      else if (nextErrors.message) messageRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      await createClientsAnnouncement({
        title: trimField(title),
        message: trimField(message),
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
          setFieldErrors({});
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
        <FormField
          ref={titleRef}
          label="Titre"
          required
          type="text"
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            setFieldErrors((current) => {
              if (!current.title) return current;
              const next = { ...current };
              delete next.title;
              return next;
            });
          }}
          placeholder="Ex. Réunion des parents"
          error={fieldErrors.title}
          editable={!saving}
        />
        <FormField
          ref={messageRef}
          label="Message"
          required
          type="multiline"
          value={message}
          onChangeText={(value) => {
            setMessage(value);
            setFieldErrors((current) => {
              if (!current.message) return current;
              const next = { ...current };
              delete next.message;
              return next;
            });
          }}
          placeholder="Ex. La réunion aura lieu jeudi à 16 h."
          error={fieldErrors.message}
          editable={!saving}
        />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  create: { minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
});
