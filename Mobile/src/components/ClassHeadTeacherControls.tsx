import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import type { SchoolClass } from "../data/catalog";
import {
  assignClassHeadTeacher,
  listClassHeadTeacherCandidates,
  removeClassHeadTeacher,
  type HeadTeacherCandidate,
} from "../services/api";
import { canAssignClassHeadTeacher } from "../lib/mobileCrudParity";
import {
  HEAD_TEACHER_COPY,
  applyHeadTeacherClassPatch,
  classHasHeadTeacher,
  formatHeadTeacherDisplayName,
  isActiveClass,
} from "../lib/classHeadTeacher";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { OFFLINE_COPY } from "../lib/offlineModeSpec";

function candidateLabel(candidate: HeadTeacherCandidate): string {
  return (
    String(candidate.displayName ?? "").trim() ||
    formatHeadTeacherDisplayName(candidate.firstName, candidate.lastName)
  );
}

function candidateHint(candidate: HeadTeacherCandidate): string {
  if (candidate.alreadyHeadTeacherHint) return candidate.alreadyHeadTeacherHint;
  const names = (candidate.otherClassNames ?? []).filter(Boolean);
  return names.length ? HEAD_TEACHER_COPY.alreadyHint(names.join(", ")) : "";
}

export default function ClassHeadTeacherControls({
  schoolClass,
  networkRequired = false,
  onBlockedMutation,
  onClassUpdated,
}: {
  schoolClass: SchoolClass;
  networkRequired?: boolean;
  onBlockedMutation?: () => void;
  onClassUpdated: (next: SchoolClass) => void;
}) {
  const { session } = useAuth();
  const canAssign = canAssignClassHeadTeacher(session);
  const classActive = isActiveClass(schoolClass.status);
  const hasHeadTeacher = classHasHeadTeacher(schoolClass);
  const currentCode = String(schoolClass.headTeacherCode ?? schoolClass.headTeacher?.teacherCode ?? "").trim();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<HeadTeacherCandidate[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((row) =>
      [row.displayName, row.firstName, row.lastName, row.teacherCode, row.alreadyHeadTeacherHint]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [candidates, query]);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const classCode = String(schoolClass.classCode || schoolClass.publicId || "").trim();
      const rows = await listClassHeadTeacherCandidates(classCode);
      setCandidates(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : HEAD_TEACHER_COPY.errorNetwork);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [schoolClass.classCode, schoolClass.publicId]);

  const openModal = useCallback(() => {
    if (networkRequired) {
      onBlockedMutation?.();
      Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
      return;
    }
    if (!classActive) {
      Alert.alert("Affectation impossible", "Une classe désactivée ne peut pas recevoir de nouvelle affectation.");
      return;
    }
    setQuery("");
    setSelected(currentCode);
    setOpen(true);
    void loadCandidates();
  }, [classActive, currentCode, loadCandidates, networkRequired, onBlockedMutation]);

  const closeModal = useCallback(() => {
    if (saving) return;
    setOpen(false);
  }, [saving]);

  const confirmAssign = useCallback(async () => {
    if (!selected || saving || selected === currentCode) return;
    const classCode = String(schoolClass.classCode || schoolClass.publicId || "").trim();
    setSaving(true);
    try {
      const updated = await assignClassHeadTeacher(classCode, selected);
      onClassUpdated(applyHeadTeacherClassPatch(schoolClass as unknown as Record<string, unknown>, updated) as SchoolClass);
      setOpen(false);
      Alert.alert(
        "Affectation",
        hasHeadTeacher ? HEAD_TEACHER_COPY.successReplace : HEAD_TEACHER_COPY.successAssign,
      );
    } catch (error) {
      Alert.alert(
        "Affectation impossible",
        error instanceof Error ? error.message : HEAD_TEACHER_COPY.errorNetwork,
      );
    } finally {
      setSaving(false);
    }
  }, [currentCode, hasHeadTeacher, onClassUpdated, saving, schoolClass, selected]);

  const confirmRemove = useCallback(() => {
    Alert.alert(HEAD_TEACHER_COPY.removeTitle, HEAD_TEACHER_COPY.removeDescription, [
      { text: HEAD_TEACHER_COPY.cancel, style: "cancel" },
      {
        text: HEAD_TEACHER_COPY.remove,
        style: "destructive",
        onPress: async () => {
          const classCode = String(schoolClass.classCode || schoolClass.publicId || "").trim();
          setSaving(true);
          try {
            const updated = await removeClassHeadTeacher(classCode);
            onClassUpdated(
              applyHeadTeacherClassPatch(schoolClass as unknown as Record<string, unknown>, updated) as SchoolClass,
            );
            setOpen(false);
            Alert.alert("Affectation", HEAD_TEACHER_COPY.successRemove);
          } catch (error) {
            Alert.alert(
              "Affectation impossible",
              error instanceof Error ? error.message : HEAD_TEACHER_COPY.errorNetwork,
            );
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  }, [onClassUpdated, schoolClass]);

  if (!canAssign || !classActive) return null;

  return (
    <>
      <Pressable
        testID={`assign-head-teacher-${String(schoolClass.classCode || schoolClass.id)}`}
        accessibilityRole="button"
        accessibilityLabel={hasHeadTeacher ? HEAD_TEACHER_COPY.modify : HEAD_TEACHER_COPY.assign}
        onPress={openModal}
        style={styles.actionBtn}
      >
        <Text style={styles.actionText}>
          {hasHeadTeacher ? HEAD_TEACHER_COPY.modify : HEAD_TEACHER_COPY.assign}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.overlay}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text style={styles.title}>
              {hasHeadTeacher ? HEAD_TEACHER_COPY.modalTitleModify : HEAD_TEACHER_COPY.modalTitleAssign}
            </Text>
            <TextInput
              accessibilityLabel={HEAD_TEACHER_COPY.search}
              placeholder={HEAD_TEACHER_COPY.search}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              style={styles.search}
            />
            {loading ? (
              <ActivityIndicator color="#2563EB" style={{ marginVertical: 16 }} />
            ) : loadError ? (
              <Text style={styles.error}>{loadError}</Text>
            ) : filtered.length === 0 ? (
              <Text style={styles.empty}>{HEAD_TEACHER_COPY.empty}</Text>
            ) : (
              <ScrollView style={styles.list}>
                {filtered.map((candidate) => {
                  const isSelected = selected === candidate.teacherCode;
                  const hint = candidateHint(candidate);
                  return (
                    <Pressable
                      key={candidate.teacherCode}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={hint ? `${candidateLabel(candidate)}. ${hint}` : candidateLabel(candidate)}
                      onPress={() => setSelected(candidate.teacherCode)}
                      style={[styles.row, isSelected && styles.rowSelected]}
                    >
                      <Text style={styles.rowName}>{candidateLabel(candidate)}</Text>
                      {hint ? <Text style={styles.otherHint}>{hint}</Text> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.footer}>
              {hasHeadTeacher ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={HEAD_TEACHER_COPY.remove}
                  onPress={confirmRemove}
                  disabled={saving}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.dangerText}>{HEAD_TEACHER_COPY.remove}</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <View style={styles.footerRight}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={HEAD_TEACHER_COPY.cancel}
                  onPress={closeModal}
                  disabled={saving}
                  style={styles.ghostBtn}
                >
                  <Text style={styles.ghostText}>{HEAD_TEACHER_COPY.cancel}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={HEAD_TEACHER_COPY.confirm}
                  onPress={() => void confirmAssign()}
                  disabled={saving || !selected || selected === currentCode}
                  style={[styles.primaryBtn, (saving || !selected || selected === currentCode) && styles.disabled]}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryText}>{HEAD_TEACHER_COPY.confirm}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    justifyContent: "center",
    marginBottom: 8,
  },
  actionText: { color: "#1D4ED8", fontWeight: "800", fontSize: 13 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 18,
    maxHeight: "80%",
  },
  title: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 12 },
  search: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    color: "#0F172A",
  },
  list: { maxHeight: 280 },
  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  rowSelected: { backgroundColor: "#EFF6FF" },
  rowName: { fontWeight: "800", color: "#0F172A" },
  otherHint: { color: "#B45309", fontSize: 12, marginTop: 2 },
  empty: { color: "#64748B", paddingVertical: 16 },
  error: { color: "#B91C1C", paddingVertical: 16, fontWeight: "700" },
  footer: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  footerRight: { flexDirection: "row", gap: 8, alignItems: "center" },
  ghostBtn: { minHeight: MIN_TOUCH_TARGET_DP, justifyContent: "center", paddingHorizontal: 8 },
  ghostText: { color: "#64748B", fontWeight: "700" },
  dangerText: { color: "#B91C1C", fontWeight: "800" },
  primaryBtn: {
    backgroundColor: "#2563EB",
    borderRadius: 14,
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  primaryText: { color: "#fff", fontWeight: "800" },
});
