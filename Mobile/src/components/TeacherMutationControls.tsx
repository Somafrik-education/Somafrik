import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import SecretHandoffModal, { type OneShotCredentials } from "./SecretHandoffModal";
import { canCreateTeacherIdentity, resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { createTeacherIdentityFromUsers, deleteSchoolTeacher, updateSchoolTeacher } from "../services/api";

type TeacherRow = {
  id: string;
  publicId?: string;
  identifier?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  gender?: string;
  phone?: string;
  email?: string;
  mainSubject?: string;
  teacherCode?: string;
};

function teacherCodeOf(row: TeacherRow): string {
  return String(row.teacherCode || row.publicId || row.identifier || row.id).trim();
}

function credentialsFromTeacherCreate(
  payload: { credentials?: { login?: string; temporarySecret?: string } },
  fallbackSecret: string,
): OneShotCredentials {
  const login = String(payload.credentials?.login ?? "").trim();
  const secret = String(payload.credentials?.temporarySecret ?? fallbackSecret).trim();
  if (!login || !secret) {
    throw new Error("Le secret temporaire n'a pas pu être remis. Aucun succès local.");
  }
  return { login, secret };
}

export default function TeacherMutationControls({
  row,
  onChanged,
}: {
  row?: TeacherRow;
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "teachers");
  const canCreate = canCreateTeacherIdentity(session);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [handoff, setHandoff] = useState<OneShotCredentials | null>(null);
  const editing = Boolean(row);

  const openForm = (target?: TeacherRow) => {
    setError("");
    const nameParts = String(target?.name ?? "").trim().split(/\s+/);
    setFirstName(target?.firstName || nameParts[0] || "");
    setLastName(target?.lastName || nameParts.slice(1).join(" ") || "");
    setPhone(target?.phone ?? "");
    setEmail(target?.email ?? "");
    setBirthDate("");
    setTemporaryPassword("");
    setOpen(true);
  };

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Prénom et nom sont obligatoires.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing && row) {
        await updateSchoolTeacher(teacherCodeOf(row), {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          ...(birthDate.trim() ? { birthDate: birthDate.trim() } : {}),
        });
        setOpen(false);
        await onChanged();
        return;
      }
      if (!temporaryPassword.trim()) {
        throw new Error("Mot de passe temporaire obligatoire.");
      }
      const schoolCode = String(session?.school?.code ?? session?.user.schoolCode ?? "").trim();
      const created = await createTeacherIdentityFromUsers({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        ...(birthDate.trim() ? { birthDate: birthDate.trim() } : {}),
        temporaryPassword: temporaryPassword.trim(),
        ...(schoolCode && schoolCode !== "*" ? { schoolCode } : {}),
      });
      const issued = credentialsFromTeacherCreate(created, temporaryPassword.trim());
      setOpen(false);
      setHandoff(issued);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!row || !access.canDelete) return;
    Alert.alert("Archiver l'enseignant", "Le compte d'accès sera désactivé côté serveur.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Archiver",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSchoolTeacher(teacherCodeOf(row));
            await onChanged();
          } catch (err) {
            Alert.alert("Suppression impossible", err instanceof Error ? err.message : "Échec serveur.");
          }
        },
      },
    ]);
  };

  const fields = (
    <CanonicalMutationModal
      visible={open}
      title={editing ? "Modifier l'enseignant" : "Créer un enseignant"}
      error={error}
      saving={saving}
      onClose={() => setOpen(false)}
      onSubmit={() => void submit()}
    >
      <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholder="Prénom" editable={!saving} />
      <TextInput style={styles.input} value={lastName} onChangeText={setLastName} placeholder="Nom" editable={!saving} />
      <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="Téléphone" keyboardType="phone-pad" editable={!saving} />
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" editable={!saving} />
      <TextInput style={styles.input} value={birthDate} onChangeText={setBirthDate} placeholder="Naissance AAAA-MM-JJ" editable={!saving} />
      {!editing ? (
        <TextInput style={styles.input} value={temporaryPassword} onChangeText={setTemporaryPassword} placeholder="Mot de passe temporaire" secureTextEntry editable={!saving} />
      ) : null}
      {!editing ? (
        <Text style={styles.hint}>Cycle canonique : compte Utilisateurs puis rôle Enseignant. POST /teachers est interdit.</Text>
      ) : null}
    </CanonicalMutationModal>
  );

  const issuedModal = (
    <SecretHandoffModal
      visible={Boolean(handoff)}
      title="Remettre les identifiants enseignant"
      credentials={handoff}
      onAck={() => setHandoff(null)}
    />
  );

  if (row) {
    if (!access.canUpdate && !access.canDelete) return null;
    return (
      <View style={styles.row}>
        {access.canUpdate ? (
          <TouchableOpacity style={styles.small} onPress={() => openForm(row)} accessibilityRole="button" accessibilityLabel="Modifier l'enseignant">
            <Text style={styles.smallText}>Modifier</Text>
          </TouchableOpacity>
        ) : null}
        {access.canDelete ? (
          <TouchableOpacity style={styles.smallDanger} onPress={remove} accessibilityRole="button" accessibilityLabel="Archiver l'enseignant">
            <Text style={styles.smallDangerText}>Archiver</Text>
          </TouchableOpacity>
        ) : null}
        {fields}
        {issuedModal}
      </View>
    );
  }

  if (!canCreate) return null;
  return (
    <>
      <TouchableOpacity style={styles.create} onPress={() => openForm()} testID="teachers-create" accessibilityRole="button" accessibilityLabel="Créer un enseignant">
        <Text style={styles.createText}>Créer un enseignant</Text>
      </TouchableOpacity>
      {fields}
      {issuedModal}
    </>
  );
}

const styles = StyleSheet.create({
  create: { minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
  row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  small: { minHeight: MIN_TOUCH_TARGET_DP, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#E2E8F0", justifyContent: "center" },
  smallText: { color: "#0F172A", fontWeight: "800" },
  smallDanger: { minHeight: MIN_TOUCH_TARGET_DP, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#FEE2E2", justifyContent: "center" },
  smallDangerText: { color: "#B91C1C", fontWeight: "800" },
  input: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, padding: 12, marginBottom: 10, color: "#0F172A" },
  hint: { color: "#64748B", fontWeight: "700" },
});
