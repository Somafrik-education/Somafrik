import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { getEffectivePermissionsForSession, hasSecurityPermission } from "../domain/security/permissions";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import {
  activeClassNames,
  activeCoursesForClass,
  assignableSubjectsForClass,
} from "../lib/schoolClassCourses";
import { OFFLINE_COPY } from "../lib/offlineModeSpec";
import { shouldBlockUnsupportedMutations, shouldSkipMetierGet } from "../offline/l1/readModel";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import {
  createSchoolClassCourse,
  createSchoolSubject,
  getEducationSchoolCatalog,
  listSchoolSubjects,
  saveSchoolEducationActivation,
  type SchoolSubjectRecord,
} from "../services/schoolSettingsApi";
import type { EducationSchoolCatalog } from "../services/api";

function toggleId(current: string[], id: string) {
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}

export default function SchoolPedagogicalStructureScreen() {
  const { session, permissionsBootstrap } = useAuth();
  const { canOpen, canEdit } = useSchoolSettingsAccess("SchoolPedagogicalStructure");
  const { classesData, loadClasses, loadSchoolCourses, schoolCoursesSnapshot, classesSnapshot, refreshBackOfficeState } = useAdminData();
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [catalog, setCatalog] = useState<EducationSchoolCatalog | null>(null);
  const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [subjects, setSubjects] = useState<SchoolSubjectRecord[]>([]);
  const classCourses = schoolCoursesSnapshot.data;
  const coursePanelLoading = schoolCoursesSnapshot.status === "loading";
  const coursePanelError =
    schoolCoursesSnapshot.status === "error" || schoolCoursesSnapshot.status === "offline"
      ? schoolCoursesSnapshot.errorMessage || "Impossible de charger les cours des classes."
      : "";
  const [selectedClassName, setSelectedClassName] = useState("");
  const [selectedSubjectName, setSelectedSubjectName] = useState("");
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectCode, setNewSubjectCode] = useState("");
  const [courseSaving, setCourseSaving] = useState<"subject" | "course" | null>(null);
  const mutationsBlocked = shouldBlockUnsupportedMutations({
    source: schoolCoursesSnapshot.source ?? classesSnapshot.source,
    permissionsBootstrap,
  });

  const effectivePermissions = getEffectivePermissionsForSession(session);
  const canReadClassCourses =
    hasSecurityPermission(session, "Matières", "READ") ||
    effectivePermissions.includes("Gérer cours") ||
    effectivePermissions.includes("Voir classes");
  const canCreateClassCourses =
    hasSecurityPermission(session, "Matières", "CREATE") || effectivePermissions.includes("Gérer cours");

  const load = useCallback(async () => {
    if (shouldSkipMetierGet(permissionsBootstrap)) {
      setCatalog(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await getEducationSchoolCatalog();
      setCatalog(response);
      setSelectedLevelIds((response.levels ?? []).filter((row) => row.schoolActive).map((row) => row.id));
      setSelectedStreamIds((response.streams ?? []).filter((row) => row.schoolActive).map((row) => row.id));
      setSelectedGroupIds((response.groups ?? []).filter((row) => row.schoolActive).map((row) => row.id));
    } catch (err) {
      setCatalog(null);
      setError(err instanceof Error ? err.message : "Impossible de charger le référentiel disponible.");
    } finally {
      setLoading(false);
    }
  }, [permissionsBootstrap]);

  const loadClassCourseData = useCallback(async () => {
    if (!canReadClassCourses) {
      setSubjects([]);
      return;
    }
    await loadSchoolCourses();
    if (shouldSkipMetierGet(permissionsBootstrap)) {
      setSubjects([]);
      return;
    }
    try {
      const subjectRows = await listSchoolSubjects();
      setSubjects(subjectRows);
    } catch {
      setSubjects([]);
    }
  }, [canReadClassCourses, loadSchoolCourses, permissionsBootstrap]);

  useEffect(() => {
    void load();
    void loadClasses();
    void loadClassCourseData();
  }, [load, loadClasses, loadClassCourseData]);

  const streamsByType = useMemo(() => {
    const groups: Record<string, EducationSchoolCatalog["streams"]> = { filiere: [], serie: [], option: [] };
    for (const stream of catalog?.streams ?? []) {
      const key = stream.streamType && groups[stream.streamType] ? stream.streamType : "filiere";
      groups[key].push(stream);
    }
    return groups;
  }, [catalog]);

  const classNames = useMemo(() => activeClassNames(classesData), [classesData]);

  useEffect(() => {
    if (!classNames.length) {
      setSelectedClassName("");
      return;
    }
    setSelectedClassName((current) =>
      current && classNames.includes(current) ? current : classNames[0],
    );
  }, [classNames.join("\u0000")]);

  const selectedClassCourses = useMemo(
    () => activeCoursesForClass(classCourses, selectedClassName),
    [classCourses, selectedClassName],
  );
  const availableSubjects = useMemo(
    () => assignableSubjectsForClass(subjects, classCourses, selectedClassName),
    [subjects, classCourses, selectedClassName],
  );

  useEffect(() => {
    if (!availableSubjects.length) {
      setSelectedSubjectName("");
      return;
    }
    setSelectedSubjectName((current) =>
      current && availableSubjects.some((subject) => subject.name === current)
        ? current
        : availableSubjects[0].name,
    );
  }, [selectedClassName, availableSubjects.map((subject) => subject.name).join("\u0000")]);

  async function save() {
    if (mutationsBlocked) {
      Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
      return;
    }
    if (!canEdit) {
      Alert.alert("Lecture seule", "Vous n’avez pas le droit de modifier l’activation pédagogique.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await saveSchoolEducationActivation({
        levelIds: selectedLevelIds,
        streamIds: selectedStreamIds,
        groupIds: selectedGroupIds,
      });
      setCatalog(saved);
      await refreshBackOfficeState();
      Alert.alert("Enregistré", "Structure pédagogique activée pour l’établissement.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement de l’activation refusé.");
    } finally {
      setSaving(false);
    }
  }

  async function addCourseToClass() {
    if (mutationsBlocked) {
      Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
      return;
    }
    if (!canCreateClassCourses) {
      Alert.alert("Lecture seule", "Vous n’avez pas le droit d’ajouter un cours à une classe.");
      return;
    }
    if (!selectedClassName || !selectedSubjectName || courseSaving) return;
    setCourseSaving("course");
    try {
      await createSchoolClassCourse({
        className: selectedClassName,
        subjectName: selectedSubjectName,
      });
      await loadSchoolCourses();
      void refreshBackOfficeState().catch(() => null);
      Alert.alert("Cours ajouté", `${selectedSubjectName} est maintenant configuré pour ${selectedClassName}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Création du cours impossible.";
      Alert.alert("Création refusée", message);
    } finally {
      setCourseSaving(null);
    }
  }

  async function createCatalogSubject() {
    if (mutationsBlocked) {
      Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
      return;
    }
    const name = newSubjectName.trim();
    const code = newSubjectCode.trim().toUpperCase();
    if (!canCreateClassCourses) {
      Alert.alert("Lecture seule", "Vous n’avez pas le droit de créer un cours.");
      return;
    }
    if (!name || !code || courseSaving) return;
    setCourseSaving("subject");
    try {
      await createSchoolSubject({ name, code });
      const rows = await listSchoolSubjects();
      setSubjects(rows);
      setNewSubjectName("");
      setNewSubjectCode("");
      setSelectedSubjectName(name);
      void refreshBackOfficeState().catch(() => null);
      Alert.alert("Cours créé", `${name} est disponible dans le catalogue de l’établissement.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Création du cours impossible.";
      Alert.alert("Création refusée", message);
    } finally {
      setCourseSaving(null);
    }
  }

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
      keyboardShouldPersistTaps="handled"
      testID="school-pedagogical-structure"
    >
      <Text style={styles.title}>Structure pédagogique</Text>
      <Text style={styles.subtitle}>
        Référentiels disponibles pour votre établissement. Vous activez un sous-ensemble du catalogue national, sans le modifier.
      </Text>

      {loading ? <Text style={styles.meta}>Chargement…</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {!loading && !catalog ? (
        <Text style={styles.meta}>Référentiel indisponible.</Text>
      ) : null}

      {catalog ? (
        <>
          <Text style={styles.meta}>
            Pays de l’établissement : {catalog.countryCode || "—"}. Les libellés nationaux ne sont pas modifiables ici.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{catalog.labels?.levelLabel ?? "Niveau"}s disponibles</Text>
            {(catalog.levels ?? []).length ? (
              catalog.levels.map((level) => (
                <CheckRow
                  key={level.id}
                  label={level.name}
                  checked={selectedLevelIds.includes(level.id)}
                  disabled={!canEdit}
                  onToggle={() => setSelectedLevelIds((current) => toggleId(current, level.id))}
                />
              ))
            ) : (
              <Text style={styles.meta}>Aucun niveau défini pour ce pays. Contactez le Super administrateur ou l’Administrateur pays.</Text>
            )}
          </View>

          {(["filiere", "serie", "option"] as const).map((streamType) => (
            <View key={streamType} style={styles.card}>
              <Text style={styles.cardTitle}>
                {streamType === "filiere" ? "Filières" : streamType === "serie" ? "Séries" : "Options"}
              </Text>
              {streamsByType[streamType]?.length ? (
                streamsByType[streamType].map((stream) => (
                  <CheckRow
                    key={stream.id}
                    label={stream.name}
                    checked={selectedStreamIds.includes(stream.id)}
                    disabled={!canEdit}
                    onToggle={() => setSelectedStreamIds((current) => toggleId(current, stream.id))}
                  />
                ))
              ) : (
                <Text style={styles.meta}>Aucune entrée pour cette catégorie.</Text>
              )}
            </View>
          ))}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{catalog.labels?.groupLabel ?? "Groupe"}s disponibles</Text>
            {(catalog.groups ?? []).length ? (
              catalog.groups.map((group) => (
                <CheckRow
                  key={group.id}
                  label={group.name || group.code || group.id}
                  checked={selectedGroupIds.includes(group.id)}
                  disabled={!canEdit}
                  onToggle={() => setSelectedGroupIds((current) => toggleId(current, group.id))}
                />
              ))
            ) : (
              <Text style={styles.meta}>Aucun groupe défini pour ce pays. Contactez le Super administrateur ou l’Administrateur pays.</Text>
            )}
          </View>

          {canEdit && !mutationsBlocked ? (
            <TouchableOpacity
              style={styles.primary}
              onPress={() => void save()}
              disabled={saving}
              testID="school-activation-save"
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>{saving ? "Enregistrement…" : "Enregistrer l’activation"}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.readOnly}>Lecture seule — l’activation n’est pas modifiable pour ce rôle.</Text>
          )}
        </>
      ) : null}

      <View style={[styles.card, styles.coursePanel]} testID="school-class-courses-panel">
        <Text style={styles.cardTitle}>Cours des classes</Text>
        {mutationsBlocked ? (
          <Text style={styles.meta} testID="l1-offline-banner">
            {OFFLINE_COPY.l1SchoolCoursesHint}
            {schoolCoursesSnapshot.cachedAt ? ` : ${schoolCoursesSnapshot.cachedAt}` : ""}
          </Text>
        ) : null}
        <Text style={styles.sectionDescription}>
          Les cours créés ici sont les mêmes que sur le Web et sont enregistrés pour la classe sélectionnée.
        </Text>

        {!canReadClassCourses ? (
          <Text style={styles.readOnly}>Lecture des cours non autorisée pour ce rôle.</Text>
        ) : coursePanelLoading ? (
          <Text style={styles.meta}>Chargement des cours…</Text>
        ) : (
          <>
            {coursePanelError ? (
              <Text style={styles.error} accessibilityRole="alert">
                {coursePanelError}
              </Text>
            ) : null}

            {!classNames.length ? (
              <Text style={styles.meta}>Aucune classe active. Créez d’abord une classe dans le module Classes.</Text>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Classe</Text>
                <View style={styles.chipWrap} testID="school-class-courses-classes">
                  {classNames.map((className) => {
                    const selected = className === selectedClassName;
                    return (
                      <TouchableOpacity
                        key={className}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setSelectedClassName(className)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`Cours de ${className}`}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{className}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fieldLabel}>Cours configurés pour {selectedClassName}</Text>
                {selectedClassCourses.length ? (
                  <View style={styles.courseList} testID="school-class-courses-list">
                    {selectedClassCourses.map((course) => (
                      <View key={course.id} style={styles.courseRow}>
                        <Text style={styles.courseName}>{course.name}</Text>
                        {Number.isFinite(course.coefficient) ? (
                          <Text style={styles.courseMeta}>Coeff. {course.coefficient}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.meta}>Aucun cours n’est encore rattaché à cette classe.</Text>
                )}

                {mutationsBlocked ? (
                  <Text style={styles.readOnly}>{OFFLINE_COPY.mutationRequiresConnection}</Text>
                ) : canCreateClassCourses ? (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.fieldLabel}>Ajouter un cours existant</Text>
                    {availableSubjects.length ? (
                      <>
                        <View style={styles.chipWrap} testID="school-class-courses-subjects">
                          {availableSubjects.map((subject) => {
                            const selected = subject.name === selectedSubjectName;
                            return (
                              <TouchableOpacity
                                key={subject.code}
                                style={[styles.chip, selected && styles.subjectChipSelected]}
                                onPress={() => setSelectedSubjectName(subject.name)}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                                accessibilityLabel={`Sélectionner ${subject.name}`}
                              >
                                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                                  {subject.name}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <TouchableOpacity
                          style={[styles.primary, styles.primaryCompact]}
                          onPress={() => void addCourseToClass()}
                          disabled={!selectedSubjectName || courseSaving !== null}
                          testID="school-class-course-add"
                          accessibilityRole="button"
                        >
                          <Text style={styles.primaryText}>
                            {courseSaving === "course" ? "Ajout…" : `Ajouter à ${selectedClassName}`}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <Text style={styles.meta}>
                        Tous les cours actifs du catalogue sont déjà rattachés à cette classe, ou le catalogue est vide.
                      </Text>
                    )}

                    <View style={styles.divider} />
                    <Text style={styles.fieldLabel}>Créer un cours dans le catalogue</Text>
                    <Text style={styles.hint}>
                      Comme sur le Web, cette étape crée d’abord le cours établissement. Vous pourrez ensuite l’ajouter à la classe ci-dessus.
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={newSubjectName}
                      onChangeText={setNewSubjectName}
                      placeholder="Nom du cours"
                      autoCapitalize="sentences"
                      testID="school-subject-name-input"
                    />
                    <TextInput
                      style={styles.input}
                      value={newSubjectCode}
                      onChangeText={(value) => setNewSubjectCode(value.toUpperCase())}
                      placeholder="Code (ex. MATH)"
                      autoCapitalize="characters"
                      testID="school-subject-code-input"
                    />
                    <TouchableOpacity
                      style={[styles.secondary, (!newSubjectName.trim() || !newSubjectCode.trim()) && styles.disabledButton]}
                      onPress={() => void createCatalogSubject()}
                      disabled={!newSubjectName.trim() || !newSubjectCode.trim() || courseSaving !== null}
                      testID="school-subject-create"
                      accessibilityRole="button"
                    >
                      <Text style={styles.secondaryText}>
                        {courseSaving === "subject" ? "Création…" : "Créer le cours"}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.readOnly}>
                    Lecture seule — vous n’avez pas le droit de créer ou rattacher un cours.
                  </Text>
                )}
              </>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function CheckRow({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.checkRow}
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 26, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 10 },
  sectionDescription: { color: "#64748B", lineHeight: 20, marginBottom: 14 },
  meta: { color: "#64748B", fontWeight: "600", marginBottom: 10, lineHeight: 20 },
  error: { color: "#991B1B", fontWeight: "800", marginBottom: 12, lineHeight: 20 },
  readOnly: { color: "#B45309", fontWeight: "700", marginTop: 8, lineHeight: 20 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, marginBottom: 6 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#94A3B8",
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  tick: { color: "#FFFFFF", fontWeight: "900", fontSize: 12 },
  checkLabel: { color: "#111827", fontWeight: "700", flex: 1 },
  primary: { backgroundColor: "#2563EB", borderRadius: 16, padding: 16, minHeight: 48, justifyContent: "center" },
  primaryCompact: { marginTop: 10 },
  primaryText: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
  coursePanel: { marginTop: 16 },
  fieldLabel: { color: "#111827", fontWeight: "800", marginTop: 8, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chip: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
    borderRadius: 999,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 9,
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: "#1D4ED8", borderColor: "#1D4ED8" },
  subjectChipSelected: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { color: "#334155", fontWeight: "700" },
  chipTextSelected: { color: "#FFFFFF" },
  courseList: { gap: 8, marginBottom: 10 },
  courseRow: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  courseName: { color: "#111827", fontWeight: "800", flex: 1 },
  courseMeta: { color: "#64748B", fontWeight: "700" },
  divider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 14 },
  hint: { color: "#64748B", lineHeight: 19, marginBottom: 10 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#FFFFFF",
    color: "#111827",
    marginBottom: 10,
  },
  secondary: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryText: { color: "#1D4ED8", textAlign: "center", fontWeight: "800" },
  disabledButton: { opacity: 0.45 },
});
