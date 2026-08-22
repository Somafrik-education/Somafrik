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
  validateUserIdentityDraft,
} from "../lib/formFieldValidation";
import { canGrantUserRole, resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { createClientsUser, grantClientsUserRole, updateClientsUser } from "../services/api";

type UserRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  gender?: string;
  status?: string;
  role?: string;
  identifier?: string;
  publicId?: string;
  activeRoles?: string[];
  roleKeys?: string[];
  secondaryRoles?: string[];
};

function hasTeacherRole(row: UserRow): boolean {
  const tokens = [
    row.role,
    ...(row.activeRoles ?? []),
    ...(row.secondaryRoles ?? []),
    ...(row.roleKeys ?? []),
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return tokens.some((value) => value === "enseignant" || value === "teacher");
}

export default function UserMutationControls({
  row,
  onChanged,
}: {
  row?: UserRow;
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "users");
  const canGrant = canGrantUserRole(session);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [handoff, setHandoff] = useState<OneShotCredentials | null>(null);
  const firstNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
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

  const openForm = (target?: UserRow) => {
    setError("");
    setFieldErrors({});
    setFirstName(target?.firstName ?? "");
    setLastName(target?.lastName ?? "");
    setEmail(target?.email ?? "");
    setPhone(target?.phone ?? "");
    setTemporaryPassword("");
    setOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    const nextErrors = validateUserIdentityDraft({
      firstName,
      lastName,
      email,
      phone,
      temporaryPassword,
      editing,
    });
    if (hasFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors);
      setError("");
      const focus = firstErrorKey(
        ["firstName", "lastName", "email", "phone", "temporaryPassword"],
        nextErrors,
      );
      if (focus === "firstName") firstNameRef.current?.focus();
      else if (focus === "lastName") lastNameRef.current?.focus();
      else if (focus === "email") emailRef.current?.focus();
      else if (focus === "phone") phoneRef.current?.focus();
      else if (focus === "temporaryPassword") passwordRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const schoolCode = String(session?.school?.code ?? session?.user.schoolCode ?? "").trim();
      const first = trimField(firstName);
      const last = trimField(lastName);
      const emailValue = trimField(email);
      const phoneValue = trimField(phone);
      const secret = trimField(temporaryPassword);
      if (editing && row) {
        await updateClientsUser(row.id, {
          firstName: first,
          lastName: last,
          email: emailValue,
          phone: phoneValue,
        });
        setOpen(false);
        await onChanged();
        return;
      }
      const created = await createClientsUser({
        firstName: first,
        lastName: last,
        email: emailValue,
        phone: phoneValue,
        temporaryPassword: secret,
        ...(schoolCode && schoolCode !== "*" ? { schoolCode } : {}),
      });
      const login = String(created.publicId || created.identifier || created.id || "").trim();
      if (!login) {
        throw new Error("L'identifiant du compte n'a pas pu être remis. Aucun succès local.");
      }
      setOpen(false);
      setHandoff({ login, secret });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const grantTeacher = () => {
    if (!row || !canGrant || hasTeacherRole(row) || granting) return;
    Alert.alert("Attribuer le rôle Enseignant", "Le profil enseignant sera créé côté serveur à partir de ce compte.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Attribuer",
        onPress: async () => {
          setGranting(true);
          try {
            await grantClientsUserRole(row.id, "Enseignant");
            await onChanged();
          } catch (err) {
            Alert.alert("Attribution impossible", err instanceof Error ? err.message : "Échec serveur.");
          } finally {
            setGranting(false);
          }
        },
      },
    ]);
  };

  const fields = (
    <CanonicalMutationModal
      visible={open}
      title={editing ? "Modifier l'utilisateur" : "Créer un utilisateur"}
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
        placeholder="Ex. Esther"
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
        placeholder="Ex. Okito"
        error={fieldErrors.lastName}
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
        placeholder="Ex. parent@email.com"
        error={fieldErrors.email}
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
      <Text style={styles.hint}>La matrice RBAC reste Web-only. L'attribution du rôle Enseignant à un compte est autorisée.</Text>
    </CanonicalMutationModal>
  );

  const issuedModal = (
    <SecretHandoffModal
      visible={Boolean(handoff)}
      title="Remettre les identifiants utilisateur"
      credentials={handoff}
      onAck={() => setHandoff(null)}
    />
  );

  if (row) {
    if (!access.canUpdate && !canGrant) return null;
    return (
      <View style={styles.row}>
        {access.canUpdate ? (
          <TouchableOpacity style={styles.small} onPress={() => openForm(row)} accessibilityRole="button" accessibilityLabel="Modifier l'utilisateur">
            <Text style={styles.smallText}>Modifier</Text>
          </TouchableOpacity>
        ) : null}
        {canGrant && !hasTeacherRole(row) ? (
          <TouchableOpacity
            style={styles.small}
            onPress={grantTeacher}
            disabled={granting}
            accessibilityRole="button"
            accessibilityLabel="Attribuer le rôle Enseignant"
            testID="users-grant-teacher"
          >
            <Text style={styles.smallText}>{granting ? "Attribution…" : "Attribuer Enseignant"}</Text>
          </TouchableOpacity>
        ) : null}
        {fields}
        {issuedModal}
      </View>
    );
  }
  if (!access.canCreate) return null;
  return (
    <>
      <TouchableOpacity style={styles.create} onPress={() => openForm()} testID="users-create" accessibilityRole="button" accessibilityLabel="Créer un utilisateur">
        <Text style={styles.createText}>Créer un utilisateur</Text>
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
  small: { minHeight: MIN_TOUCH_TARGET_DP, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#E2E8F0", justifyContent: "center", alignSelf: "flex-start" },
  smallText: { color: "#0F172A", fontWeight: "800" },
  hint: { color: "#64748B", fontWeight: "700" },
});
