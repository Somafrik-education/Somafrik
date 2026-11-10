import { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { removableAssignmentsForTeacher } from "../lib/teacherAssignmentRemoval";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { deleteTeacherAssignment, type TeacherAssignment } from "../services/api";

export default function TeacherAssignmentRemovalControls({
  teacherCode,
  assignments,
  onChanged,
}: {
  teacherCode?: string;
  assignments: TeacherAssignment[];
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const { canDelete } = resolveEntityCrudAccess(session, "assignments");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rows = removableAssignmentsForTeacher(teacherCode, assignments);

  if (!canDelete || !rows.length) return null;

  const remove = (assignment: TeacherAssignment) => {
    const id = String(assignment.id ?? "").trim();
    if (!id || removingId) return;
    Alert.alert(
      "Retirer cette affectation ?",
      `Retirer ${assignment.course || assignment.subject || "ce cours"} de la classe ${assignment.className} pour cet enseignant ? Le cours et les notes existantes seront conservés.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer",
          style: "destructive",
          onPress: () => {
            if (removingId) return;
            setRemovingId(id);
            setError("");
            void (async () => {
              try {
                await deleteTeacherAssignment(id);
                try {
                  await onChanged();
                } catch {
                  setError("Affectation retirée, mais actualisation impossible. Rechargez la liste.");
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : "Retrait impossible.");
              } finally {
                setRemovingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Affectations actives</Text>
      {rows.map((assignment) => {
        const id = String(assignment.id);
        return (
          <View key={id} style={styles.row}>
            <Text style={styles.description}>
              {assignment.className} · {assignment.course || assignment.subject}
            </Text>
            <TouchableOpacity
              testID={`teacher-assignment-remove-${id}`}
              accessibilityRole="button"
              accessibilityLabel={`Retirer l'affectation ${assignment.course || assignment.subject} de ${assignment.className}`}
              accessibilityState={{ disabled: Boolean(removingId), busy: removingId === id }}
              style={[styles.button, Boolean(removingId) && styles.disabled]}
              disabled={Boolean(removingId)}
              onPress={() => remove(assignment)}
            >
              <Text style={styles.buttonText}>{removingId === id ? "Retrait…" : "Retirer"}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12, gap: 8 },
  title: { fontWeight: "800", color: "#0F172A" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  description: { flex: 1, color: "#334155", fontWeight: "600" },
  button: { minHeight: MIN_TOUCH_TARGET_DP, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, backgroundColor: "#FEE2E2" },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#991B1B", fontWeight: "800" },
  error: { color: "#B91C1C", fontWeight: "700" },
});
