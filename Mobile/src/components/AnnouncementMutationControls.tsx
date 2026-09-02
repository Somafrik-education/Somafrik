import { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import FormField from "./FormField";
import { hasFieldErrors, trimField, validateAnnouncementDraft } from "../lib/formFieldValidation";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { hasCommunicationSchoolScope, withCommunicationSchoolPayload } from "../lib/communicationSchoolScope";
import { isSuperAdminSessionRole } from "../domain/security/permissions";
import {
  createClientsAnnouncement,
  createPlatformAnnouncement,
  getAnnouncementAudienceOptions,
  uploadAnnouncementAttachment,
  uploadPlatformAnnouncementAttachment,
} from "../services/api";

export default function AnnouncementMutationControls({
  onChanged,
}: {
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const { activeSchoolCode } = useAdminData();
  const access = resolveEntityCrudAccess(session, "announcements");
  const platformComposer = isSuperAdminSessionRole(session?.role) || isSuperAdminSessionRole(session?.user?.role);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [scopeType, setScopeType] = useState<"school" | "roles" | "classes">("school");
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [classes, setClasses] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [kinds, setKinds] = useState<Array<{ id: string; label: string }>>([
    { id: "parent", label: "parents" },
    { id: "teacher", label: "enseignants" },
    { id: "student", label: "élèves" },
    { id: "staff", label: "personnel" },
  ]);
  const [platformType, setPlatformType] = useState<"administrative" | "system">("administrative");
  const [platformAudience, setPlatformAudience] = useState<
    "country_admins" | "school_admins" | "all_admins" | "all_active_users"
  >("country_admins");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const titleRef = useRef<TextInput>(null);
  const messageRef = useRef<TextInput>(null);
  const scopeReady = platformComposer || hasCommunicationSchoolScope(activeSchoolCode);

  useEffect(() => {
    if (!open || !scopeReady || platformComposer) return;
    void getAnnouncementAudienceOptions(activeSchoolCode)
      .then((data) => {
        setClasses(data.classes);
        if (data.recipientKinds.length) setKinds(data.recipientKinds);
      })
      .catch(() => {
        setClasses([]);
      });
  }, [open, scopeReady, activeSchoolCode]);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const pickFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png"],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const saved = platformComposer
      ? await uploadPlatformAnnouncementAttachment({
          uri: asset.uri,
          name: asset.name ?? "fichier",
          mimeType: asset.mimeType ?? "application/pdf",
        })
      : await uploadAnnouncementAttachment(
          { uri: asset.uri, name: asset.name ?? "fichier", mimeType: asset.mimeType ?? "application/pdf" },
          activeSchoolCode,
        );
    setAttachmentIds((current) => [...current, saved.id]);
  };

  const pickImage = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const saved = platformComposer
      ? await uploadPlatformAnnouncementAttachment({
          uri: asset.uri,
          name: "image.jpg",
          mimeType: asset.mimeType ?? "image/jpeg",
        })
      : await uploadAnnouncementAttachment(
          { uri: asset.uri, name: "image.jpg", mimeType: asset.mimeType ?? "image/jpeg" },
          activeSchoolCode,
        );
    setAttachmentIds((current) => [...current, saved.id]);
  };

  const submit = async () => {
    if (saving) return;
    if (!platformComposer && !scopeReady) {
      setError("Établissement requis.");
      return;
    }
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
      if (platformComposer) {
        if (platformType === "system") {
          const confirmed = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Annonce système Somafrik",
              "Cette annonce sera visible par tous les utilisateurs actifs de Somafrik.",
              [
                { text: "Annuler", style: "cancel", onPress: () => resolve(false) },
                { text: "Publier", onPress: () => resolve(true) },
              ],
            );
          });
          if (!confirmed) {
            setSaving(false);
            return;
          }
        }
        await createPlatformAnnouncement(
          {
            announcementType: platformType,
            audienceKey: platformType === "system" ? "all_active_users" : platformAudience,
            title: trimField(title),
            message: trimField(message),
            attachmentIds,
          },
          { idempotencyKey: `${Date.now()}-${Math.random().toString(16).slice(2)}` },
        );
      } else {
        const payload: Record<string, unknown> = {
          title: trimField(title),
          message: trimField(message),
          attachmentIds,
        };
        if (scopeType === "school") payload.audience = "Tous";
        else if (scopeType === "roles") payload.recipientKinds = selectedKinds;
        else {
          payload.classIds = selectedClasses;
          payload.recipientKinds = selectedKinds;
        }
        await createClientsAnnouncement(withCommunicationSchoolPayload(payload, activeSchoolCode), {
          idempotencyKey: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        });
      }
      setOpen(false);
      setTitle("");
      setMessage("");
      setAttachmentIds([]);
      setSelectedKinds([]);
      setSelectedClasses([]);
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
        {!platformComposer && !scopeReady ? <Text style={styles.hint}>Sélectionnez un établissement pour publier.</Text> : null}
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
        {platformComposer ? (
          <>
            <Text style={styles.hint}>Type d'annonce</Text>
            <TouchableOpacity
              onPress={() => {
                setPlatformType("administrative");
                if (platformAudience === "all_active_users") setPlatformAudience("country_admins");
              }}
            >
              <Text style={platformType === "administrative" ? styles.kindOn : styles.kindOff}>Annonce administrative</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setPlatformType("system");
                setPlatformAudience("all_active_users");
              }}
            >
              <Text style={platformType === "system" ? styles.kindOn : styles.kindOff}>Annonce système Somafrik</Text>
            </TouchableOpacity>
            {platformType === "administrative" ? (
              <>
                <Text style={styles.hint}>Audience</Text>
                {(
                  [
                    ["country_admins", "Administrateurs pays"],
                    ["school_admins", "Administrateurs d'établissement"],
                    ["all_admins", "Tous les administrateurs"],
                  ] as const
                ).map(([id, label]) => (
                  <TouchableOpacity key={id} onPress={() => setPlatformAudience(id)}>
                    <Text style={platformAudience === id ? styles.kindOn : styles.kindOff}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </>
            ) : (
              <Text style={styles.hint}>Audience : Tous les utilisateurs Somafrik</Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.hint}>Audience</Text>
            {(["school", "roles", "classes"] as const).map((value) => (
              <TouchableOpacity key={value} onPress={() => setScopeType(value)}>
                <Text style={scopeType === value ? styles.kindOn : styles.kindOff}>
                  {value === "school" ? "Établissement entier" : value === "roles" ? "Rôle(s)" : "Classe(s) + catégories"}
                </Text>
              </TouchableOpacity>
            ))}
            {scopeType !== "school"
              ? kinds.map((kind) => (
                  <TouchableOpacity key={kind.id} onPress={() => setSelectedKinds((current) => toggle(current, kind.id))}>
                    <Text style={selectedKinds.includes(kind.id) ? styles.kindOn : styles.kindOff}>{kind.label}</Text>
                  </TouchableOpacity>
                ))
              : null}
            {scopeType === "classes"
              ? classes.map((row) => (
                  <TouchableOpacity key={row.id} onPress={() => setSelectedClasses((current) => toggle(current, row.id))}>
                    <Text style={selectedClasses.includes(row.id) ? styles.kindOn : styles.kindOff}>
                      {row.name || row.code}
                    </Text>
                  </TouchableOpacity>
                ))
              : null}
          </>
        )}
        <View style={styles.row}>
          <TouchableOpacity onPress={() => void pickFile()}><Text style={styles.link}>PDF</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => void pickImage()}><Text style={styles.link}>Image</Text></TouchableOpacity>
        </View>
        {attachmentIds.length ? <Text style={styles.hint}>{attachmentIds.length} pièce(s) jointe(s)</Text> : null}
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  create: { minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
  hint: { color: "#64748B", marginBottom: 8, fontWeight: "700" },
  kindOn: { color: "#2563EB", fontWeight: "800", marginBottom: 4 },
  kindOff: { color: "#334155", marginBottom: 4 },
  row: { flexDirection: "row", gap: 16, marginTop: 8 },
  link: { color: "#2563EB", fontWeight: "800" },
});
