import { useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import FormField from "./FormField";
import SecretHandoffModal, { type OneShotCredentials } from "./SecretHandoffModal";
import {
  firstErrorKey,
  hasFieldErrors,
  trimField,
  validateTeacherIdentityDraft,
} from "../lib/formFieldValidation";
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [handoff, setHandoff] = useState<OneShotCredentials | null>(null);
  const firstNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const birthDateRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const editing = Boolean(row);

  const clearFieldError = (key: string) => {
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const openForm = (target?: TeacherRow) => {
    setError("");
    setFieldErrors({});
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
    if (saving) return;
    const nextErrors = validateTeacherIdentityDraft({
      firstName,
      lastName,
      phone,
      email,
      birthDate,
      temporaryPassword,
      editing,
    });
    if (hasFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors);
      setError("");
      const focus = firstErrorKey(
        ["firstName", "lastName", "phone", "email", "birthDate", "temporaryPassword"],
        nextErrors,
      );
      if (focus === "firstName") firstNameRef.current?.focus();
      else if (focus === "lastName") lastNameRef.current?.focus();
      else if (focus === "phone") phoneRef.current?.focus();
      else if (focus === "email") emailRef.current?.focus();
      else if (focus === "birthDate") birthDateRef.current?.focus();
      else if (focus === "temporaryPassword") passwordRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const first = trimField(firstName);
      const last = trimField(lastName);
      const phoneValue = trimField(phone);
      const emailValue = trimField(email);
      const birth = trimField(birthDate);
      const secret = trimField(temporaryPassword);
      if (editing && row) {
        await updateSchoolTeacher(teacherCodeOf(row), {
          firstName: first,
          lastName: last,
          phone: phoneValue || null,
          email: emailValue || null,
          ...(birth ? { birthDate: birth } : {}),
        });
        setOpen(false);
        await onChanged();
        return;
      }
      const schoolCode = String(session?.school?.code ?? session?.user.schoolCode ?? "").trim();
      const created = await createTeacherIdentityFromUsers({
        firstName: first,
        lastName: last,
        phone: phoneValue || undefined,
        email: emailValue || undefined,
        ...(birth ? { birthDate: birth } : {}),
        temporaryPassword: secret,
        ...(schoolCode && schoolCode !== "*" ? { schoolCode } : {}),
      });
      const issued = credentialsFromTeacherCreate(created, secret);
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
      <FormField
        ref={firstNameRef}
        label="Prénom"
        required
        type="name"
        autoComplete="given-name"
        value={firstName}
        onChangeText={(value) => {
          setFirstName(value);
          clearFieldError("firstName");
        }}
        placeholder="Ex. Amina"
        error={fieldErrors.firstName}
        editable={!saving}
      />
      <FormField
        ref={lastNameRef}
        label="Nom"
        required
        type="name"
        autoComplete="family-name"
        value={lastName}
        onChangeText={(value) => {
          setLastName(value);
          clearFieldError("lastName");
        }}
        placeholder="Ex. Kabila"
        error={fieldErrors.lastName}
        editable={!saving}
      />
      <FormField
        ref={phoneRef}
        label="Téléphone"
        optional
        type="phone"
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          clearFieldError("phone");
        }}
        placeholder="Ex. +243 8xx xxx xxx"
        error={fieldErrors.phone}
        editable={!saving}
      />
      <FormField
        ref={emailRef}
        label="Email"
        optional
        type="email"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          clearFieldError("email");
        }}
        placeholder="Ex. amina@ecole.cd"
        error={fieldErrors.email}
        editable={!saving}
      />
      <FormField
        ref={birthDateRef}
        label="Date de naissance"
        optional
        type="date"
        value={birthDate}
        onChangeText={(value) => {
          setBirthDate(value);
          clearFieldError("birthDate");
        }}
        placeholder="Ex. 1990-05-01"
        error={fieldErrors.birthDate}
        editable={!saving}
      />
      {!editing ? (
        <FormField
          ref={passwordRef}
          label="Mot de passe temporaire"
          required
          type="password"
          value={temporaryPassword}
          onChangeText={(value) => {
            setTemporaryPassword(value);
            clearFieldError("temporaryPassword");
          }}
          placeholder="Ex. mot de passe à remettre"
          error={fieldErrors.temporaryPassword}
          editable={!saving}
        />
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
  hint: { color: "#64748B", fontWeight: "700" },
});
