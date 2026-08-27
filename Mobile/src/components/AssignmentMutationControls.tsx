import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import ChoiceChips from "./ChoiceChips";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { createTeacherAssignment } from "../services/api";

type TeacherRow = { id: string; publicId?: string; identifier?: string; teacherCode?: string; name?: string };
type ClassRow = { name?: string; classCode?: string; publicId?: string };
type SubjectRow = { name?: string; code?: string; subjectCode?: string };

export default function AssignmentMutationControls({
  teachers,
  classes,
  subjects,
  onChanged,
}: {
  teachers: TeacherRow[];
  classes: ClassRow[];
  subjects: SubjectRow[];
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "assignments");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [teacherCode, setTeacherCode] = useState("");
  const [classCode, setClassCode] = useState("");
  const [subjectCode, setSubjectCode] = useState("");

  const teacherOptions = useMemo(
    () =>
      teachers.map((item) => ({
        id: String(item.teacherCode || item.publicId || item.identifier || item.id),
        label: item.name || item.id,
      })),
    [teachers],
  );
  const classOptions = useMemo(
    () =>
      classes
        .map((item) => ({ id: String(item.classCode || item.publicId || ""), label: String(item.name || "") }))
        .filter((item) => item.id),
    [classes],
  );
  const subjectOptions = useMemo(
    () =>
      subjects
        .map((item) => ({ id: String(item.subjectCode || item.code || item.name || ""), label: String(item.name || item.code || "") }))
        .filter((item) => item.id),
    [subjects],
  );

  const submit = async () => {
    if (!teacherCode || !classCode || !subjectCode) {
      setError("Enseignant, classe et cours sont obligatoires.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createTeacherAssignment({
        teacherCode,
        classCode,
        subjectCode,
      });
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Affectation impossible.");
    } finally {
      setSaving(false);
    }
  };

  if (!access.canCreate) return null;
  return (
    <>
      <TouchableOpacity style={styles.create} onPress={() => setOpen(true)} testID="assignments-create" accessibilityRole="button" accessibilityLabel="Affecter un cours">
        <Text style={styles.createText}>Affecter un cours</Text>
      </TouchableOpacity>
      <CanonicalMutationModal
        visible={open}
        title="Affecter un cours"
        error={error}
        saving={saving}
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
      >
        <ChoiceChips label="Enseignant" required options={teacherOptions} selectedId={teacherCode} onSelect={setTeacherCode} disabled={saving} />
        <ChoiceChips label="Classe" required options={classOptions} selectedId={classCode} onSelect={setClassCode} disabled={saving} />
        <ChoiceChips label="Cours" required options={subjectOptions} selectedId={subjectCode} onSelect={setSubjectCode} disabled={saving} />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  create: { minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 14, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  createText: { color: "#FFFFFF", fontWeight: "900" },
});
