import { useCallback, useEffect, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import FormField from "../components/FormField";
import ChoiceChips from "../components/ChoiceChips";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { useAdminData } from "../context/AdminDataContext";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { schoolHasLogo, schoolLogoDisplayUri } from "../lib/schoolLogo";
import { getApiBaseUrl } from "../services/api";
import {
  deleteEstablishmentLogo,
  getEstablishmentProfile,
  patchEstablishmentProfile,
  uploadEstablishmentLogo,
  type EstablishmentProfileRecord,
} from "../services/schoolSettingsApi";

const SCHOOL_TYPES = [
  "École primaire",
  "Collège",
  "Lycée",
  "Université",
  "Institut",
  "Centre de formation",
];

function emptyDraft(): EstablishmentProfileRecord {
  return {
    code: "",
    name: "",
    type: "Collège",
    address: "",
    phone: "",
    email: "",
    logoUrl: "",
    hasLogo: false,
    principalName: "",
    principalEmail: "",
    principalPhone: "",
  };
}

export default function EstablishmentProfileScreen() {
  const { canOpen, canEdit, session } = useSchoolSettingsAccess("EstablishmentProfile");
  const { activeSchoolCode, availableSchools, refreshBackOfficeState } = useAdminData();
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [draft, setDraft] = useState<EstablishmentProfileRecord>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const schoolCode =
    (activeSchoolCode && activeSchoolCode !== "*" ? activeSchoolCode : "") ||
    String(session?.school?.code || session?.user?.schoolCode || "").trim();

  const load = useCallback(async () => {
    if (!schoolCode) {
      setError("Sélectionnez un établissement actif.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const profile = await getEstablishmentProfile(schoolCode);
      const local = availableSchools.find((school) => school.code === schoolCode);
      setDraft({
        code: profile.code || schoolCode,
        name: profile.name || local?.name || "",
        type: profile.type || local?.type || "Collège",
        address: profile.address || local?.address || "",
        phone: profile.phone || local?.phone || "",
        email: profile.email || local?.email || "",
        logoUrl: profile.logoUrl || "",
        hasLogo: profile.hasLogo ?? schoolHasLogo(profile) || schoolHasLogo(local),
        city: profile.city || local?.city || "",
        principalName: profile.principalName || "",
        principalEmail: profile.principalEmail || "",
        principalPhone: profile.principalPhone || "",
        loginCode: profile.loginCode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger le profil.");
    } finally {
      setLoading(false);
    }
  }, [availableSchools, schoolCode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!canEdit) {
      Alert.alert("Lecture seule", "Vous n’avez pas le droit de modifier le profil.");
      return;
    }
    if (!schoolCode || saving) return;
    setSaving(true);
    setError("");
    try {
      await patchEstablishmentProfile(schoolCode, {
        name: draft.name,
        type: draft.type,
        address: draft.address,
        phone: draft.phone,
        email: draft.email,
        principalName: draft.principalName,
        principalEmail: draft.principalEmail,
        principalPhone: draft.principalPhone,
      });
      await refreshBackOfficeState();
      Alert.alert("Enregistré", "Le profil de l’établissement a été mis à jour.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement refusé.");
    } finally {
      setSaving(false);
    }
  }

  async function pickLogo() {
    if (!canEdit || uploading || !schoolCode) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission requise", "Autorisez l'accès aux photos pour importer un logo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const asset = result.assets[0];
    setUploading(true);
    setError("");
    try {
      await uploadEstablishmentLogo(schoolCode, {
        uri: asset.uri,
        name: asset.fileName || "logo.jpg",
        mimeType: asset.mimeType || "image/jpeg",
      });
      await refreshBackOfficeState();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'upload du logo.");
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    if (!canEdit || uploading || !schoolCode) return;
    setUploading(true);
    setError("");
    try {
      await deleteEstablishmentLogo(schoolCode);
      await refreshBackOfficeState();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer le logo.");
    } finally {
      setUploading(false);
    }
  }

  const logoUri = schoolLogoDisplayUri(draft, getApiBaseUrl());
  const logoActionLabel = schoolHasLogo(draft) ? "Modifier le logo" : "Ajouter un logo";

  if (!canOpen) return <SchoolSettingsDenied />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        padding: horizontalPadding,
        paddingBottom: bottomPadding,
        maxWidth: contentMaxWidth,
        alignSelf: "center",
        width: "100%",
      }}
    >
      <Text style={styles.title}>Profil établissement</Text>
      <Text style={styles.subtitle}>Identité locale de l’établissement. Le code de connexion n’est pas modifiable ici.</Text>

      {loading ? <Text style={styles.meta}>Chargement…</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <TouchableOpacity
        style={styles.logoZone}
        onPress={() => void pickLogo()}
        disabled={!canEdit || uploading}
        accessibilityRole="button"
        accessibilityLabel={logoActionLabel}
        testID="establishment-logo-dropzone"
      >
        {logoUri ? (
          <Image source={{ uri: logoUri }} style={styles.logoPreview} />
        ) : (
          <Text style={styles.logoPlaceholder}>{canEdit ? "Ajouter un logo" : "Aucun logo"}</Text>
        )}
      </TouchableOpacity>
      {canEdit ? (
        <View style={styles.logoActions}>
          <TouchableOpacity
            style={styles.secondary}
            onPress={() => void pickLogo()}
            disabled={uploading}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>{uploading ? "Envoi…" : logoActionLabel}</Text>
          </TouchableOpacity>
          {schoolHasLogo(draft) ? (
            <TouchableOpacity
              style={styles.tertiary}
              onPress={() => void removeLogo()}
              disabled={uploading}
              accessibilityRole="button"
            >
              <Text style={styles.tertiaryText}>Supprimer le logo</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <FormField
        label="Nom"
        required
        value={draft.name}
        onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
        editable={canEdit}
      />
      <ChoiceChips
        label="Type"
        required
        selectedId={draft.type || "Collège"}
        onSelect={(type) => setDraft((current) => ({ ...current, type }))}
        options={SCHOOL_TYPES.map((type) => ({ id: type, label: type }))}
        disabled={!canEdit}
      />
      <FormField
        label="Adresse"
        value={draft.address}
        onChangeText={(address) => setDraft((current) => ({ ...current, address }))}
        editable={canEdit}
      />
      <FormField
        label="Téléphone"
        type="phone"
        required
        value={draft.phone}
        onChangeText={(phone) => setDraft((current) => ({ ...current, phone }))}
        editable={canEdit}
      />
      <FormField
        label="Courriel"
        type="email"
        required
        value={draft.email}
        onChangeText={(email) => setDraft((current) => ({ ...current, email }))}
        editable={canEdit}
      />
      <FormField
        label="Responsable légal"
        type="name"
        required
        value={draft.principalName}
        onChangeText={(principalName) => setDraft((current) => ({ ...current, principalName }))}
        editable={canEdit}
      />
      <FormField
        label="Courriel du responsable"
        type="email"
        value={draft.principalEmail}
        onChangeText={(principalEmail) => setDraft((current) => ({ ...current, principalEmail }))}
        editable={canEdit}
      />
      <FormField
        label="Téléphone du responsable"
        type="phone"
        value={draft.principalPhone}
        onChangeText={(principalPhone) => setDraft((current) => ({ ...current, principalPhone }))}
        editable={canEdit}
      />
      {draft.loginCode || schoolCode ? (
        <Text style={styles.meta}>Code établissement : {draft.loginCode || schoolCode}</Text>
      ) : null}

      {canEdit ? (
        <TouchableOpacity
          style={styles.primary}
          onPress={() => void save()}
          disabled={saving}
          accessibilityRole="button"
          testID="establishment-profile-save"
        >
          <Text style={styles.primaryText}>{saving ? "Enregistrement…" : "Enregistrer"}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.readOnly}>Lecture seule.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 26, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  meta: { color: "#64748B", fontWeight: "700", marginBottom: 12 },
  error: { color: "#991B1B", fontWeight: "800", marginBottom: 12 },
  readOnly: { color: "#B45309", fontWeight: "700", marginTop: 8 },
  logoZone: {
    minHeight: 128,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    padding: 12,
  },
  logoPreview: { width: 120, height: 96, resizeMode: "contain" },
  logoPlaceholder: { color: "#111827", fontWeight: "800" },
  logoActions: { marginBottom: 16, gap: 8 },
  secondary: { backgroundColor: "#E2E8F0", borderRadius: 16, padding: 14, minHeight: 48, justifyContent: "center" },
  secondaryText: { color: "#0F172A", fontWeight: "800", textAlign: "center" },
  tertiary: { padding: 8, minHeight: 44, justifyContent: "center" },
  tertiaryText: { color: "#2563EB", fontWeight: "700", textAlign: "center" },
  primary: { backgroundColor: "#2563EB", borderRadius: 16, padding: 16, marginTop: 8, minHeight: 48, justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
});
