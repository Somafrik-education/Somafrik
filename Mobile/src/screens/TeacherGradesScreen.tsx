import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { AcademicGrade, GradeBookService } from "../domain/academics/GradeBookService";
import { resolveActivePeriodName } from "../lib/academicPeriods";
import { hasSecurityPermission } from "../domain/security/permissions";
import {
  classNameMatches,
  filterStudentsByClassName,
  resolveGradesPeriod,
  resolveStudentApiId,
  resolveTeacherAssignmentsForSession,
  scopedStudentsForSession,
} from "../lib/establishment";
import { saveNote, getEvaluationTypes, type CanonicalEvaluationType } from "../services/api";
import { ApiClientError } from "../services/httpClient";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";

type Assignment = {
  className: string;
  course: string;
};

type GradeSession = {
  id: string;
  type: string;
  typeId: string;
  period: string;
  date: string;
  scale: string;
  assignment: Assignment;
  values: Record<string, string>;
  gradeIds: Record<string, string>;
};

type SessionSummary = {
  id: string;
  type: string;
  period: string;
  date: string;
  scale: number;
  assignment: Assignment;
  grades: AcademicGrade[];
};

export default function TeacherGradesScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const contentStyle = [
    styles.content,
    {
      paddingBottom: scrollContentPaddingBottom,
      paddingHorizontal: horizontalPadding,
      maxWidth: contentMaxWidth,
      alignSelf: "center" as const,
      width: "100%" as const,
    },
  ];
  const { session } = useAuth();
  const {
    studentsData,
    coursesData,
    notesData,
    presencesData,
    teachersData,
    assignmentsData,
    classesData,
    academicConfigData,
    refreshBackOfficeState,
  } = useAdminData();
  const [gradeSession, setGradeSession] = useState<GradeSession | null>(null);
  const [evaluationTypeCatalog, setEvaluationTypeCatalog] = useState<CanonicalEvaluationType[]>([]);
  const [evaluationTypesError, setEvaluationTypesError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getEvaluationTypes();
        if (cancelled) return;
        setEvaluationTypeCatalog((payload.types ?? []).filter((row) => row.status === "active"));
        setEvaluationTypesError("");
      } catch (error) {
        if (cancelled) return;
        setEvaluationTypeCatalog([]);
        if (error instanceof ApiClientError) {
          if (error.status === 400) setEvaluationTypesError(error.message || "Requête invalide.");
          else if (error.status === 403) setEvaluationTypesError("Accès refusé au catalogue des types d'évaluation.");
          else if (error.status === 404) setEvaluationTypesError("Type d'évaluation introuvable.");
          else if (error.status === 409) setEvaluationTypesError("Ce type d'évaluation n'est plus utilisable.");
          else if ((error.status ?? 0) >= 500) setEvaluationTypesError("Erreur serveur lors du chargement des types.");
          else setEvaluationTypesError(error.message);
        } else {
          setEvaluationTypesError(error instanceof Error ? error.message : "Impossible de charger les types d'évaluation.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);
  const canCreateNotes = hasSecurityPermission(session, "Notes", "CREATE");
  const canUpdateNotes = hasSecurityPermission(session, "Notes", "UPDATE");
  const scopeState = useMemo(
    () => ({ teachers: teachersData, assignments: assignmentsData, classes: classesData }),
    [teachersData, assignmentsData, classesData],
  );
  const scopedStudents = useMemo(
    () => scopedStudentsForSession(session, studentsData, scopeState),
    [session, studentsData, scopeState],
  );
  const assignments: Assignment[] = useMemo(() => {
    if (session?.role !== "teacher") {
      return coursesData.map((course) => ({ className: course.className, course: course.name }));
    }
    return resolveTeacherAssignmentsForSession(session, assignmentsData);
  }, [session, assignmentsData, coursesData]);
  const gradeBook = new GradeBookService(scopedStudents, notesData, coursesData);
  const todayLabel = formatDate(new Date());
  const todayIso = formatIsoDate(new Date());
  const evaluationTypes = evaluationTypeCatalog.filter((row) => row.status === "active");
  const periods = academicConfigData.periods.length
    ? academicConfigData.periods
    : [{ name: "Trimestre 1", type: "Trimestre", startDate: "", endDate: "", active: true }];
  const calendarPeriod = resolveActivePeriodName(periods) ?? "Trimestre 1";
  const activePeriod = resolveGradesPeriod(
    notesData,
    String(session?.user?.schoolCode ?? session?.school?.code ?? ""),
    calendarPeriod,
  );

  const sessions = useMemo(
    () => buildSessionSummaries(notesData, assignments, scopedStudents),
    [assignments, notesData, scopedStudents],
  );

  const presentStudents = useMemo(() => {
    if (!gradeSession) return [];
    return filterStudentsByClassName(scopedStudents, gradeSession.assignment.className).filter((student) => {
      if (gradeSession.gradeIds[student.id]) return true;
      return isPresentOnDate(student.id, presencesData, gradeSession.date, todayIso);
    });
  }, [gradeSession, presencesData, scopedStudents, todayIso]);

  const startSession = (assignment: Assignment) => {
    if (!canCreateNotes) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de créer une session de notes.");
      return;
    }

    const rows = filterStudentsByClassName(scopedStudents, assignment.className).filter((student) =>
      isPresentOnDate(student.id, presencesData, todayLabel, todayIso),
    );

    if (!rows.length) {
      Alert.alert(
        "Aucun élève présent",
        "Faites d'abord l'appel des présences pour cette classe. La session de notes ne prend que les élèves présents ou en retard."
      );
      return;
    }

    if (!evaluationTypes.length) {
      Alert.alert(
        "Types d'évaluation indisponibles",
        evaluationTypesError || "Aucun type actif n'est défini pour cet établissement.",
      );
      return;
    }

    if (!academicConfigData.schoolCode || !Number.isFinite(Number(academicConfigData.defaultScale)) || Number(academicConfigData.defaultScale) <= 0) {
      Alert.alert(
        "Configuration indisponible",
        "Le barème par défaut de l'établissement n'est pas chargé. Réessayez après synchronisation.",
      );
      return;
    }

    const type = evaluationTypes[0];
    setGradeSession({
      id: `EVAL-${Date.now()}`,
      type: type.name,
      typeId: type.id,
      period: activePeriod,
      date: todayLabel,
      scale: String(academicConfigData.defaultScale),
      assignment,
      values: Object.fromEntries(rows.map((student) => [student.id, ""])),
      gradeIds: {},
    });
  };

  const openSession = (summary: SessionSummary) => {
    if (!canUpdateNotes) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de modifier une session de notes.");
      return;
    }

    const gradeByStudent = Object.fromEntries(summary.grades.map((grade) => [grade.studentId, grade]));
    const rows = filterStudentsByClassName(scopedStudents, summary.assignment.className);
    setGradeSession({
      id: summary.id,
      type: summary.type,
      typeId: evaluationTypes.find((row) => row.name === summary.type)?.id ?? "",
      period: summary.period,
      date: summary.date,
      scale: String(summary.scale),
      assignment: summary.assignment,
      values: Object.fromEntries(rows.map((student) => [student.id, gradeByStudent[student.id]?.value?.toString() ?? ""])),
      gradeIds: Object.fromEntries(summary.grades.map((grade) => [grade.studentId, grade.id])),
    });
  };

  const updateGradeValue = (studentId: string, value: string) => {
    setGradeSession((current) =>
      current ? { ...current, values: { ...current.values, [studentId]: value } } : current
    );
  };

  const updateSessionDate = (date: string) => {
    setGradeSession((current) => {
      if (!current) return current;

      const allowedStudents = filterStudentsByClassName(scopedStudents, current.assignment.className).filter(
        (student) => current.gradeIds[student.id] || isPresentOnDate(student.id, presencesData, date, todayIso),
      );
      const allowedIds = new Set(allowedStudents.map((student) => student.id));

      return {
        ...current,
        date,
        values: Object.fromEntries(
          Object.entries(current.values).filter(([studentId]) => allowedIds.has(studentId))
        ),
      };
    });
  };

  const updateSessionType = (type: CanonicalEvaluationType) => {
    setGradeSession((current) => current ? { ...current, type: type.name, typeId: type.id } : current);
  };

  const saveSession = async () => {
    if (!gradeSession) return;

    const missingStudent = presentStudents.find((student) => !gradeSession.values[student.id]?.trim());
    if (missingStudent) {
      Alert.alert("Note manquante", `Veuillez saisir la note de ${missingStudent.name}.`);
      return;
    }

    const coefficient = coursesData.find(
      (course) =>
        classNameMatches(course.className, gradeSession.assignment.className) &&
        course.name === gradeSession.assignment.course,
    )?.coefficient ?? 1;
    const authorId = session?.user.id ?? "teacher";
    const scale = Number(gradeSession.scale.replace(",", "."));

    if (Number.isNaN(scale) || scale <= 0) {
      Alert.alert("Barème invalide", "Veuillez saisir une cote valide, par exemple 20.");
      return;
    }

    try {
      const savedGrades = await Promise.all(
        presentStudents.map((student) => {
          const value = Number(gradeSession.values[student.id].replace(",", "."));
          const existingGrade = notesData.find((note) => note.id === gradeSession.gradeIds[student.id]);
          const baseGrade = existingGrade
            ? gradeBook.updateGrade(existingGrade, value, authorId)
            : gradeBook.createGrade({
                studentId: resolveStudentApiId(student),
                subject: gradeSession.assignment.course,
                value,
                coefficient,
                date: gradeSession.date,
                period: gradeSession.period,
                evaluationId: gradeSession.id,
                scale,
                evaluationCoefficient: 1,
                authorId,
              });

          if (!gradeSession.typeId) {
            throw new Error("Type d'évaluation canonique obligatoire.");
          }

          return saveNote({
            ...baseGrade,
            studentId: resolveStudentApiId(student),
            evaluationTitle: gradeSession.type,
            evaluationType: gradeSession.type,
            evaluationTypeId: gradeSession.typeId,
            period: gradeSession.period,
            scale,
          }) as Promise<AcademicGrade>;
        })
      );

      await refreshBackOfficeState();
      Alert.alert("Session enregistrée", `${presentStudents.length} note(s) enregistrée(s) ou mise(s) à jour.`);
      setGradeSession(null);
    } catch (error) {
      let message = "Vérifiez les notes saisies.";
      if (error instanceof ApiClientError) {
        if (error.status === 400) message = error.message || "Requête invalide.";
        else if (error.status === 403) message = "Accès refusé.";
        else if (error.status === 404) message = "Type d'évaluation introuvable.";
        else if (error.status === 409) message = "Ce type d'évaluation n'est plus utilisable.";
        else if ((error.status ?? 0) >= 500) message = "Erreur serveur. Réessayez plus tard.";
        else message = error.message;
      } else if (error instanceof Error) {
        message = error.message;
      }
      Alert.alert("Session non enregistrée", message);
    }
  };

  if (gradeSession) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
        <TouchableOpacity style={styles.backButton} onPress={() => setGradeSession(null)}>
          <Ionicons name="arrow-back" size={18} color="#0F172A" />
          <Text style={styles.backText}>Retour aux sessions</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Session de notes</Text>
        <Text style={styles.subtitle}>
          {gradeSession.assignment.className} • {gradeSession.assignment.course} • {presentStudents.length} élève(s)
        </Text>

        <Text style={styles.label}>Type de session</Text>
        <View style={styles.typeRow}>
          {evaluationTypes.map((type) => (
            <TouchableOpacity
              key={type.id}
              style={[styles.typePill, gradeSession.typeId === type.id && styles.typePillActive]}
              onPress={() => updateSessionType(type)}
            >
              <Text style={[styles.typeText, gradeSession.typeId === type.id && styles.typeTextActive]}>{type.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Période</Text>
        <View style={styles.typeRow}>
          {periods.map((period) => (
            <TouchableOpacity
              key={period.name}
              style={[styles.typePill, gradeSession.period === period.name && styles.typePillActive]}
              onPress={() => setGradeSession((current) => current ? { ...current, period: period.name } : current)}
            >
              <Text style={[styles.typeText, gradeSession.period === period.name && styles.typeTextActive]}>{period.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Date</Text>
        <TextInput
          value={gradeSession.date}
          onChangeText={updateSessionDate}
          placeholder="JJ-MM-AAAA"
          style={styles.sessionInput}
        />

        <Text style={styles.label}>Cote de la note</Text>
        <View style={styles.scaleRow}>
          <Text style={styles.scaleSlash}>/</Text>
          <TextInput
            value={gradeSession.scale}
            onChangeText={(scale) => setGradeSession((current) => current ? { ...current, scale } : current)}
            keyboardType="numeric"
            placeholder="20"
            style={styles.scaleInput}
          />
        </View>

        <Text style={styles.presenceHint}>
          Seuls les élèves présents ou en retard le {gradeSession.date} sont affichés.
        </Text>

        {presentStudents.map((student) => {
          const average = gradeBook.getSubjectAverage(student.id, gradeSession.assignment.course).average;
          return (
            <View key={student.id} style={styles.gradeRow}>
              <View style={styles.studentInfo}>
                <Text style={styles.name}>{student.name}</Text>
                <Text style={styles.meta}>
                  {student.matricule} • moyenne actuelle {average ? average.toFixed(1) : "-"}
                </Text>
              </View>
              <TextInput
                value={gradeSession.values[student.id] ?? ""}
                onChangeText={(value) => updateGradeValue(student.id, value)}
                keyboardType="numeric"
                placeholder={`/${gradeSession.scale || "20"}`}
                style={styles.gradeInput}
              />
            </View>
          );
        })}

        <TouchableOpacity style={styles.primaryButton} onPress={saveSession}>
          <Text style={styles.primaryText}>Enregistrer la session</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Notes</Text>
      <Text style={styles.subtitle}>Sessions classées par {academicConfigData.periodMode} selon la configuration de l'établissement.</Text>

      {assignments.map((assignment, index) => {
        const classStudents = filterStudentsByClassName(scopedStudents, assignment.className);
        const presentCount = classStudents.filter((student) => isPresentOnDate(student.id, presencesData, todayLabel, todayIso)).length;
        const classStats = gradeBook.getClassStatistics(assignment.className);

        return (
          <View key={`${assignment.className}-${assignment.course}-${index}`} style={[styles.assignmentCard, isTablet && styles.assignmentCardTablet]}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.assignmentHeader}
              onPress={() => navigation.navigate("Students", { className: assignment.className })}
            >
              <View>
                <Text style={styles.assignmentTitle}>{assignment.course}</Text>
                <Text style={styles.meta}>{assignment.className} • {classStudents.length} élève(s) • {presentCount} présent(s)</Text>
              </View>
              <Ionicons name="reader-outline" size={24} color="#7C3AED" />
            </TouchableOpacity>

            <View style={styles.statsRow}>
              <StatPill label="Moy. classe" value={classStats.classAverage.toFixed(1)} />
              <StatPill label="Meilleure" value={classStats.bestAverage.toFixed(1)} />
              <StatPill label="Réussite" value={`${classStats.successRate}%`} />
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={() => startSession(assignment)}>
              <Text style={styles.primaryText}>Créer une session</Text>
            </TouchableOpacity>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Sessions existantes</Text>
      {periods.map((period) => {
        const periodSessions = sessions.filter((item) => item.period === period.name);
        if (!periodSessions.length) return null;
        return (
          <View key={period.name}>
            <Text style={styles.periodTitle}>{period.name}</Text>
            {periodSessions.map((item) => (
              <TouchableOpacity key={item.id} style={styles.historyCard} onPress={() => openSession(item)}>
                <Text style={styles.historyTitle}>{item.type}</Text>
                <Text style={styles.meta}>{item.date} • /{item.scale} • {item.assignment.className} • {item.assignment.course}</Text>
                <Text style={styles.meta}>{item.grades.length} note(s) • toucher pour consulter/modifier</Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      })}
      {!sessions.length ? <Text style={styles.empty}>Aucune session enregistrée.</Text> : null}
    </ScrollView>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function buildSessionSummaries(notes: AcademicGrade[], assignments: Assignment[], students: any[]) {
  const assignmentKeys = new Set(assignments.map((item) => `${item.className}-${item.course}`));
  const studentClassById = new Map<string, string>();
  students.forEach((student) => {
    const className = student.className;
    if (student.id) studentClassById.set(String(student.id), className);
    if (student.matricule) studentClassById.set(String(student.matricule), className);
    if (student.publicId) studentClassById.set(String(student.publicId), className);
  });
  const grouped = new Map<string, SessionSummary>();

  notes.forEach((note) => {
    const className = studentClassById.get(note.studentId);
    if (!className || !assignmentKeys.has(`${className}-${note.subject}`)) return;

    const type = note.evaluationType ?? "Devoir";
    const date = note.date;
    const period = note.period ?? "Trimestre 1";
    const scale = note.scale ?? 20;
    const key = `${className}-${note.subject}-${period}-${date}-${type}-${scale}`;
    const current: SessionSummary = grouped.get(key) ?? {
      id: key,
      type,
      period,
      date,
      scale,
      assignment: { className, course: note.subject },
      grades: [],
    };
    current.grades.push(note);
    grouped.set(key, current);
  });

  return [...grouped.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function isPresentOnDate(studentId: string, presences: any[], dateLabel: string, todayIso: string) {
  const isoDate = dateLabel.includes("-") && dateLabel.split("-")[0].length === 2
    ? `${dateLabel.slice(6, 10)}-${dateLabel.slice(3, 5)}-${dateLabel.slice(0, 2)}`
    : dateLabel;
  const entry = [...presences]
    .reverse()
    .find((presence) => presence.studentId === studentId && [dateLabel, isoDate, todayIso].includes(String(presence.date)));
  const status = String(entry?.status ?? "").toLowerCase();
  return Boolean(entry?.present) || ["présent", "present", "retard"].includes(status);
}

function formatDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

function formatIsoDate(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: "900", color: "#0F172A" },
  subtitle: { marginTop: 6, marginBottom: 20, color: "#64748B", fontWeight: "700" },
  assignmentCard: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 16, marginBottom: 16 },
  assignmentCardTablet: { maxWidth: 640, alignSelf: "center", width: "100%" },
  assignmentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  assignmentTitle: { fontSize: 20, fontWeight: "900", color: "#0F172A" },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  statPill: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 14, padding: 10 },
  statValue: { color: "#7C3AED", fontSize: 18, fontWeight: "900" },
  statLabel: { color: "#64748B", fontSize: 11, fontWeight: "800", marginTop: 2 },
  meta: { marginTop: 4, color: "#64748B", fontWeight: "700" },
  primaryButton: { backgroundColor: "#0F172A", borderRadius: 16, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  primaryText: { color: "#FFFFFF", fontWeight: "900" },
  backButton: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12, marginBottom: 14 },
  backText: { marginLeft: 8, color: "#0F172A", fontWeight: "900" },
  label: { color: "#0F172A", fontWeight: "900", marginBottom: 8 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  typePill: { backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  typePillActive: { backgroundColor: "#0F172A" },
  typeText: { color: "#334155", fontWeight: "900" },
  typeTextActive: { color: "#FFFFFF" },
  sessionInput: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 14 },
  scaleRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 16, paddingHorizontal: 14, marginBottom: 10 },
  scaleSlash: { color: "#0F172A", fontSize: 24, fontWeight: "900", marginRight: 6 },
  scaleInput: { flex: 1, paddingVertical: 14, color: "#0F172A", fontSize: 18, fontWeight: "900" },
  presenceHint: { color: "#64748B", fontWeight: "800", marginBottom: 12 },
  gradeRow: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center" },
  studentInfo: { flex: 1, paddingRight: 12 },
  name: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  gradeInput: { width: 78, borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 14, padding: 10, textAlign: "center", fontSize: 18, fontWeight: "900", color: "#0F172A" },
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginTop: 4, marginBottom: 10 },
  periodTitle: { color: "#2563EB", fontSize: 16, fontWeight: "900", marginTop: 8, marginBottom: 8 },
  historyCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 14, marginBottom: 10 },
  historyTitle: { color: "#0F172A", fontSize: 17, fontWeight: "900" },
  empty: { color: "#64748B", fontWeight: "800" },
});
