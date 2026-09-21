import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import FormField from "./FormField";
import SecretHandoffModal, { type OneShotCredentials } from "./SecretHandoffModal";
import {
  canAssignRoleToUserAccount,
  isStudentLinkedAccount,
  STUDENT_ROLE_LOCKED_MESSAGE,
  STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE,
  isTeacherRoleLabel,
} from "../lib/businessProfile";
import {
  firstErrorKey,
  hasFieldErrors,
  trimField,
  validateUserIdentityDraft,
} from "../lib/formFieldValidation";
import { canGrantUserRole, resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  alignRolesToCatalogue,
  createSingleFlight,
  currentAccessRoleLabels,
  saveUserRoleChanges,
  visibleAssignableRoles,
  type AssignableRoleChoice,
} from "../lib/userRoleAssignment";
import { createClientsUser, grantClientsUserRole, revokeClientsUserRole, updateClientsUser } from "../services/api";
import { listAssignableEstablishmentRoles } from "../services/schoolSettingsApi";

type UserRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  gender?: string;
  status?: string;
  role?: string;
  roles?: string[];
  identifier?: string;
  publicId?: string;
  activeRoles?: string[];
  roleKeys?: string[];
  secondaryRoles?: string[];
  accountKind?: string;
  linkedStudent?: { studentId?: string; studentCode?: string } | null;
  linkedTeacher?: { teacherId?: string; teacherCode?: string } | null;
};

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
  const [rolesOpen, setRolesOpen] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [rolesError, setRolesError] = useState("");
  const [catalogReady, setCatalogReady] = useState(false);
  const [roleChoices, setRoleChoices] = useState<AssignableRoleChoice[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [baselineRoles, setBaselineRoles] = useState<string[]>([]);
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
  const rolesFlight = useRef(createSingleFlight());
  const rolesSavingRef = useRef(false);
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

  const closeRoles = () => {
    if (rolesSavingRef.current || rolesSaving) return;
    setRolesOpen(false);
  };

  const openRoles = async () => {
    if (!row || !canGrant || rolesSaving) return;
    if (isStudentLinkedAccount(row)) return;
    setRolesError("");
    setCatalogReady(false);
    setRoleChoices([]);
    setSelectedRoles([]);
    setBaselineRoles([]);
    setRolesOpen(true);
    setRolesLoading(true);
    try {
      const payload = await listAssignableEstablishmentRoles();
      const choices = visibleAssignableRoles(payload.roles ?? []);
      const aligned = alignRolesToCatalogue(currentAccessRoleLabels(row), choices);
      setRoleChoices(choices);
      setSelectedRoles(aligned);
      setBaselineRoles(aligned);
      setCatalogReady(true);
    } catch (err) {
      setRolesError(err instanceof Error ? err.message : "Impossible de charger les rôles.");
      setCatalogReady(false);
    } finally {
      setRolesLoading(false);
    }
  };

  const toggleRole = (roleName: string) => {
    if (rolesSaving || !row) return;
    if (!canAssignRoleToUserAccount(row, roleName)) return;
    setSelectedRoles((current) =>
      current.includes(roleName) ? current.filter((item) => item !== roleName) : [...current, roleName],
    );
  };

  const submitRoles = () => {
    if (!row) return;
    void rolesFlight.current.run(async () => {
      if (isStudentLinkedAccount(row)) {
        setRolesError(STUDENT_ROLE_LOCKED_MESSAGE);
        return;
      }
      rolesSavingRef.current = true;
      setRolesSaving(true);
      setRolesError("");
      try {
        const result = await saveUserRoleChanges({
          user: row,
          userId: row.id,
          currentRoles: baselineRoles,
          selectedRoles,
          grant: grantClientsUserRole,
          revoke: revokeClientsUserRole,
          reload: () => onChanged(),
          reloadAfterFailure: () => onChanged(),
          onGranted: (role) => {
            setBaselineRoles((current) => (current.includes(role) ? current : [...current, role]));
          },
          onRevoked: (role) => {
            setBaselineRoles((current) => current.filter((item) => item !== role));
          },
        });
        if (!result.ok) {
          setRolesError(result.message);
          return;
        }
        setRolesOpen(false);
      } finally {
        rolesSavingRef.current = false;
        setRolesSaving(false);
      }
    });
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
      <Text style={styles.hint}>La matrice des droits reste disponible uniquement sur le Web. Les rôles d'un compte lié à un élève sont verrouillés.</Text>
    </CanonicalMutationModal>
  );

  const rolesModal = (
    <CanonicalMutationModal
      visible={rolesOpen}
      title="Gérer les rôles"
      error={rolesError}
      saving={rolesSaving}
      submitDisabled={rolesSaving || rolesLoading || !catalogReady}
      onClose={closeRoles}
      onSubmit={submitRoles}
    >
      <Text style={styles.subtitle}>Sélectionnez les rôles d'accès de cet utilisateur.</Text>
      {rolesLoading ? <Text style={styles.hint}>Chargement des rôles…</Text> : null}
      {rolesSaving ? (
        <Text style={styles.hint} testID="users-roles-saving">
          Enregistrement…
        </Text>
      ) : null}
      {!rolesLoading && catalogReady && roleChoices.length === 0 ? (
        <Text style={styles.hint}>Aucun rôle attribuable pour votre périmètre.</Text>
      ) : null}
      {roleChoices.map((role) => {
        const checked = selectedRoles.includes(role.roleName);
        const incompatible = row ? !canAssignRoleToUserAccount(row, role.roleName) : false;
        return (
          <TouchableOpacity
            key={role.roleKey}
            style={styles.roleRow}
            onPress={() => toggleRole(role.roleName)}
            disabled={rolesSaving || rolesLoading || incompatible}
            accessibilityRole="checkbox"
            accessibilityLabel={role.roleName}
            accessibilityState={{ checked, disabled: rolesSaving || rolesLoading || incompatible }}
            testID={`users-role-option-${role.roleKey}`}
          >
            <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>
              {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <View style={styles.roleCopy}>
              <Text style={styles.roleName}>{role.roleName}</Text>
              {incompatible && isTeacherRoleLabel(role.roleName) ? (
                <Text style={styles.hint}>{STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
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
        {canGrant && !isStudentLinkedAccount(row) ? (
          <TouchableOpacity
            style={styles.small}
            onPress={() => void openRoles()}
            disabled={rolesSaving}
            accessibilityRole="button"
            accessibilityLabel="Gérer les rôles"
            testID="users-manage-roles"
          >
            <Text style={styles.smallText}>Gérer les rôles</Text>
          </TouchableOpacity>
        ) : null}
        {canGrant && isStudentLinkedAccount(row) ? (
          <Text style={styles.hint}>{STUDENT_ROLE_LOCKED_MESSAGE}</Text>
        ) : null}
        {fields}
        {rolesModal}
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
  subtitle: { color: "#64748B", fontWeight: "700", marginBottom: 12, lineHeight: 20 },
  roleRow: {
    minHeight: MIN_TOUCH_TARGET_DP,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#94A3B8",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  checkboxMark: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  roleCopy: { flex: 1 },
  roleName: { color: "#0F172A", fontWeight: "800" },
});
