import { useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import ChoiceChips from "./ChoiceChips";
import FormField from "./FormField";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import {
  firstErrorKey,
  hasFieldErrors,
  resolvePreferredClassCode,
  trimField,
  validateStudentEnrollmentDraft,
} from "../lib/formFieldValidation";
import { deleteSchoolStudent, enrollClassStudent, updateSchoolStudent } from "../services/api";
import SecretHandoffModal, { type OneShotCredentials } from "./SecretHandoffModal";

type ClassOption = { id?: string; name?: string; classCode?: string; publicId?: string };
type StudentRow = {
  id: string;
  firstName?: string;
  name?: string;
  lastName?: string;
  gender?: string;
  birthDate?: string;
  parentPhone?: string;
  parentEmail?: string;
  classCode?: string;
  className?: string;
};

function classCodeOf(row: ClassOption): string {
  return String(row.classCode || row.publicId || "").trim();
}

export default function StudentMutationControls({
  row,
  className,
  classes,
  createTestId = "students-create",
  onChanged,
}: {
  row?: StudentRow;
  className?: string;
  classes: ClassOption[];
  createTestId?: string;
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "students");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [classCode, setClassCode] = useState("");
  const [handoff, setHandoff] = useState<OneShotCredentials | null>(null);
  const firstNameRef = useRef<TextInput>(null);
  const lastNameRef = useRef<TextInput>(null);
  const parentPhoneRef = useRef<TextInput>(null);
  const editing = Boolean(row);

  const classOptions = useMemo(
    () =>
      classes
        .map((item) => ({ id: classCodeOf(item), label: String(item.name || classCodeOf(item)) }))
        .filter((item) => item.id),
    [classes],
  );

  const clearFieldError = (key: string) => {
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const openCreate = () => {
    setError("");
    setFieldErrors({});
    setFirstName("");
    setLastName("");
    setParentPhone("");
    setClassCode(resolvePreferredClassCode(className, classOptions));
    setOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    const nextErrors = validateStudentEnrollmentDraft({
      firstName,
      lastName,
      parentPhone,
      classCode,
      editing,
    });
    if (hasFieldErrors(nextErrors)) {
      setFieldErrors(nextErrors);
      setError("");
      const focus = firstErrorKey(["firstName", "lastName", "parentPhone"], nextErrors);
      if (focus === "firstName") firstNameRef.current?.focus();
      else if (focus === "lastName") lastNameRef.current?.focus();
      else if (focus === "parentPhone") parentPhoneRef.current?.focus();
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const first = trimField(firstName);
      const last = trimField(lastName);
      const phone = trimField(parentPhone);
      if (editing && row) {
        await updateSchoolStudent(row.id, {
          firstName: first,
          lastName: last,
          parentPhone: phone,
        });
      } else {
        const enrolled = await enrollClassStudent(classCode, {
          firstName: first,
          lastName: last,
          parentPhone: phone || undefined,
        });
        const login = String(enrolled.credentials?.login ?? "").trim();
        const secret = String(enrolled.credentials?.temporarySecret ?? "").trim();
        if (!login || !secret) {
          throw new Error("Le secret temporaire d'inscription n'a pas pu être remis. Aucun succès local.");
        }
        setOpen(false);
        setHandoff({ login, secret });
        await onChanged();
        return;
      }
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!row || !access.canDelete) return;
    Alert.alert("Supprimer l'élève", "L'élève sera retiré côté serveur.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSchoolStudent(row.id);
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
      title={editing ? "Modifier l'élève" : "Inscrire un élève"}
      error={error}
      saving={saving}
      onClose={() => setOpen(false)}
      onSubmit={() => void submit()}
    >
      {!editing ? (
        <ChoiceChips
          label="Classe"
          required
          options={classOptions}
          selectedId={classCode}
          onSelect={(id) => {
            setClassCode(id);
            clearFieldError("classCode");
          }}
          disabled={saving}
          error={fieldErrors.classCode}
        />
      ) : null}
      <FormField
        ref={firstNameRef}
        label="Prénom"
        required
        type="name"
        autoComplete="given-name"
        textContentType="givenName"
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
        textContentType="familyName"
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
        ref={parentPhoneRef}
        label="Téléphone du parent"
        optional
        type="phone"
        value={parentPhone}
        onChangeText={(value) => {
          setParentPhone(value);
          clearFieldError("parentPhone");
        }}
        placeholder="Ex. +243 8xx xxx xxx"
        error={fieldErrors.parentPhone}
        helperText="Le même numéro peut servir pour plusieurs frères et sœurs."
        editable={!saving}
      />
    </CanonicalMutationModal>
  );

  if (row) {
    if (!access.canUpdate && !access.canDelete) return null;
    return (
      <View style={styles.row}>
        {access.canUpdate ? (
          <TouchableOpacity
            style={styles.small}
            onPress={() => {
              const parts = String(row.name ?? "").trim().split(/\s+/);
              setFirstName(row.firstName || parts[0] || "");
              setLastName(row.lastName || parts.slice(1).join(" "));
              setParentPhone(row.parentPhone ?? "");
              setError("");
              setFieldErrors({});
              setOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Modifier l'élève"
          >
            <Text style={styles.smallText}>Modifier</Text>
          </TouchableOpacity>
        ) : null}
        {access.canDelete ? (
          <TouchableOpacity style={styles.smallDanger} onPress={remove} accessibilityRole="button" accessibilityLabel="Supprimer l'élève">
            <Text style={styles.smallDangerText}>Supprimer</Text>
          </TouchableOpacity>
        ) : null}
        {fields}
      </View>
    );
  }

  if (!access.canCreate) return null;
  return (
    <>
      <TouchableOpacity style={styles.create} onPress={openCreate} testID={createTestId} accessibilityRole="button" accessibilityLabel="Inscrire un élève">
        <Text style={styles.createText}>Inscrire un élève</Text>
      </TouchableOpacity>
      {fields}
      <SecretHandoffModal
        visible={Boolean(handoff)}
        title="Remettre les identifiants élève"
        credentials={handoff}
        onAck={() => setHandoff(null)}
      />
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
});
