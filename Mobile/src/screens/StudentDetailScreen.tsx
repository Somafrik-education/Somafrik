import {
  ScrollView,
  Text,
  StyleSheet,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import StudentSwitcher from "../components/StudentSwitcher";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import { canReadRoute } from "../domain/security/permissions";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  CLASSES_STUDENT_TEST_IDS,
} from "../lib/classesStudentJourneySpec";
import { STUDENT_SUB_SCREENS_TEST_IDS } from "../lib/studentSubScreensSpec";
import { STUDENT_FICHE_LOT2_TEST_IDS } from "../lib/studentFicheLot2";
import { metricLabelFromSnapshot } from "../lib/dataTruth";
import { studentDisplayName } from "../lib/studentDisplayName";
import { normalizePresenceStatus } from "../domain/metrics/schoolMetrics";
import {
  filterRowsByStudentScope,
  sessionStudentAliasKeys,
} from "../lib/canonicalStudentIdentity";
import {
  archiveParentRelation,
  getParentRelations,
  getSchoolStudent,
  linkParent,
} from "../services/api";
import {
  canArchiveParentRelationMobile,
  canLinkParentMobile,
} from "../lib/parentLinkingAccess";
import { shouldBlockUnsupportedMutations } from "../offline/l1/readModel";
import { OFFLINE_COPY } from "../lib/offlineModeSpec";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

type Props = NativeStackScreenProps<RootStackParamList, "StudentDetail">;

type GuardianRow = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  status?: string;
};

export default function StudentDetailScreen({
  route,
  navigation,
}: Partial<Props>) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const containerStyle = [styles.container, { paddingBottom: scrollContentPaddingBottom }];
  const { session, selectedStudentId, permissionsBootstrap } = useAuth();
  const {
    notesData,
    presencesData,
    paymentsData,
    loadPresences,
    loadNotes,
    loadPayments,
    notesSnapshot,
    presencesSnapshot,
    paymentsSnapshot,
    resourceScopeKey,
  } = useAdminData();
  const studentId = route?.params?.studentId ?? selectedStudentId;
  const studentAliasKeys = sessionStudentAliasKeys({
    role: session?.role,
    selectedStudentId: studentId,
    user: session?.user,
  });
  const studentScope = {
    role: session?.role ?? null,
    studentIds: studentAliasKeys,
    identityCount: studentAliasKeys.length ? 1 : 0,
    unscoped: false,
  };
  const canSeeNotes = canReadRoute(session, "StudentNotes");
  const canSeePresences = canReadRoute(session, "StudentPresences");
  const canSeePayments = canReadRoute(session, "StudentPayments");
  const canLink = canLinkParentMobile(session);
  const canArchive = canArchiveParentRelationMobile(session);
  const mutationsBlocked = shouldBlockUnsupportedMutations({
    source: "network",
    permissionsBootstrap,
  });

  const [fiche, setFiche] = useState<Record<string, unknown> | null>(null);
  const [ficheStatus, setFicheStatus] = useState<"loading" | "error" | "success">("loading");
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkError, setLinkError] = useState("");

  const loadFiche = useCallback(async () => {
    if (!studentId) {
      setFiche(null);
      setFicheStatus("error");
      return;
    }
    setFicheStatus("loading");
    try {
      const row = await getSchoolStudent(String(studentId));
      setFiche(row);
      setFicheStatus("success");
      try {
        const relations = await getParentRelations(String(row.studentCode ?? row.id ?? studentId));
        setGuardians(
          (relations as GuardianRow[]).filter(
            (item) => String(item.status ?? "active").toLowerCase() !== "archived",
          ),
        );
      } catch {
        setGuardians([]);
      }
    } catch {
      setFiche(null);
      setGuardians([]);
      setFicheStatus("error");
    }
  }, [studentId]);

  useFocusEffect(
    useCallback(() => {
      void loadFiche();
      void loadPresences();
      void loadNotes();
      void loadPayments();
    }, [loadFiche, loadPresences, loadNotes, loadPayments, resourceScopeKey]),
  );

  if (!fiche) {
    return (
      <View style={styles.container} testID={CLASSES_STUDENT_TEST_IDS.studentDetailScreen}>
        <Text>
          {ficheStatus === "loading" ? "Chargement…" : "Élève introuvable"}
        </Text>
      </View>
    );
  }

  const student = fiche as {
    id?: string;
    studentCode?: string;
    matricule?: string;
    gender?: string;
    birthDate?: string;
    birthPlace?: string;
    className?: string;
    schoolCode?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    enrollments?: Array<{ status?: string; className?: string; academicYearName?: string; enrollmentDate?: string }>;
  };
  const studentNotes = filterRowsByStudentScope(notesData, studentScope);
  const studentPresences = filterRowsByStudentScope(presencesData, studentScope);
  const presentCount = studentPresences.filter((item) => {
    const status = normalizePresenceStatus(item);
    return status === "Présent" || status === "Retard";
  }).length;
  const studentPayments = filterRowsByStudentScope(paymentsData, studentScope);
  const notesValue = metricLabelFromSnapshot(notesSnapshot, () => String(studentNotes.length));
  const presencesValue = metricLabelFromSnapshot(presencesSnapshot, () => String(presentCount));
  const paymentsDetail = metricLabelFromSnapshot(paymentsSnapshot, () => `${studentPayments.length} opération(s)`);
  const displayName = studentDisplayName(student);
  const currentEnrollment = student.enrollments?.[0];

  const openSubScreen = (screen: "StudentNotes" | "StudentPresences" | "StudentPayments") => {
    navigation?.navigate(screen, { studentId: String(student.id ?? student.studentCode ?? studentId) });
  };

  const submitLink = async () => {
    if (mutationsBlocked) {
      Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
      return;
    }
    setLinkError("");
    try {
      await linkParent({
        studentId: String(student.studentCode ?? student.id ?? studentId),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
      });
      setFirstName("");
      setLastName("");
      setPhone("");
      await loadFiche();
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "Liaison impossible.");
    }
  };

  const archive = async (relationId: string) => {
    if (mutationsBlocked) {
      Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
      return;
    }
    try {
      await archiveParentRelation(relationId);
      await loadFiche();
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "Archivage impossible.");
    }
  };

  return (
    <ScrollView
      contentContainerStyle={containerStyle}
      testID={CLASSES_STUDENT_TEST_IDS.studentDetailScreen}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.backButton}
        testID={CLASSES_STUDENT_TEST_IDS.studentDetailBackButton}
        onPress={() => navigation?.goBack()}
        accessibilityRole="button"
        accessibilityLabel={`Retour depuis la fiche de ${displayName}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="arrow-back" size={24} color="#0F172A" />
      </TouchableOpacity>

      <StudentSwitcher />

      <ExpandableEntityCard
        title="Identité"
        subtitle={displayName}
        badge={String(student.matricule ?? "")}
        testID={STUDENT_FICHE_LOT2_TEST_IDS.identityCard}
      >
        <Text style={styles.info} testID={CLASSES_STUDENT_TEST_IDS.studentDetailName}>{displayName}</Text>
        <Text style={styles.info}>Matricule : {String(student.matricule ?? "")}</Text>
        <Text style={styles.info}>Sexe : {String(student.gender ?? "").trim() || "Non renseigné"}</Text>
        <Text style={styles.info}>Naissance : {String(student.birthDate ?? "").trim() || "Non renseignée"}</Text>
        <Text style={styles.info}>Lieu : {String(student.birthPlace ?? "").trim() || "Non renseigné"}</Text>
      </ExpandableEntityCard>

      <ExpandableEntityCard
        title="Inscription"
        subtitle={String(currentEnrollment?.className || student.className || "Sans classe")}
        badge={String(currentEnrollment?.status || "")}
        testID={STUDENT_FICHE_LOT2_TEST_IDS.enrollmentCard}
      >
        <Text style={styles.info} testID={CLASSES_STUDENT_TEST_IDS.studentDetailClass}>
          Classe : {String(currentEnrollment?.className || student.className || "—")}
        </Text>
        <Text style={styles.info}>Statut : {String(currentEnrollment?.status || "—")}</Text>
        <Text style={styles.info}>Année : {String(currentEnrollment?.academicYearName || "—")}</Text>
        <Text style={styles.info}>Date : {String(currentEnrollment?.enrollmentDate || "—")}</Text>
        <Text style={styles.info}>Établissement : {String(student.schoolCode ?? "")}</Text>
      </ExpandableEntityCard>

      <ExpandableEntityCard
        title="Responsables"
        subtitle={guardians.length ? `${guardians.length} responsable(s)` : "Aucun responsable lié"}
        badge={String(guardians.length)}
        testID={STUDENT_FICHE_LOT2_TEST_IDS.guardiansCard}
      >
        {guardians.map((guardian) => (
          <View key={guardian.id} style={styles.guardianRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuText}>
                {guardian.name || `${guardian.firstName ?? ""} ${guardian.lastName ?? ""}`.trim() || "Responsable"}
              </Text>
              <Text style={styles.info}>{guardian.phone || guardian.email || ""}</Text>
            </View>
            {canArchive ? (
              <TouchableOpacity
                onPress={() => void archive(guardian.id)}
                testID={`${STUDENT_FICHE_LOT2_TEST_IDS.archiveRelationPrefix}${guardian.id}`}
                accessibilityRole="button"
                accessibilityLabel="Archiver le responsable"
              >
                <Text style={styles.archive}>Archiver</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {canLink ? (
          <View>
            <TextInput style={styles.input} placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
            <TextInput style={styles.input} placeholder="Nom" value={lastName} onChangeText={setLastName} />
            <TextInput style={styles.input} placeholder="Téléphone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            {linkError ? <Text style={styles.error}>{linkError}</Text> : null}
            <TouchableOpacity
              style={styles.create}
              onPress={() => void submitLink()}
              testID={STUDENT_FICHE_LOT2_TEST_IDS.linkParentButton}
              accessibilityRole="button"
              accessibilityLabel="Lier un responsable"
            >
              <Text style={styles.createText}>Lier un responsable</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ExpandableEntityCard>

      <ExpandableEntityCard
        title="Notes"
        subtitle="Bulletins et évaluations"
        badge={notesValue}
        testID={STUDENT_FICHE_LOT2_TEST_IDS.notesCard}
      >
        {canSeeNotes ? (
          <StudentAction
            icon="book-outline"
            label="Notes"
            detail="Ouvrir les notes"
            testID={STUDENT_SUB_SCREENS_TEST_IDS.openNotesButton}
            onPress={() => openSubScreen("StudentNotes")}
          />
        ) : (
          <Text style={styles.info}>Lecture non autorisée.</Text>
        )}
      </ExpandableEntityCard>

      <ExpandableEntityCard
        title="Présences"
        subtitle="Suivi des absences"
        badge={presencesValue}
        testID={STUDENT_FICHE_LOT2_TEST_IDS.presencesCard}
      >
        {canSeePresences ? (
          <StudentAction
            icon="calendar-outline"
            label="Présences"
            detail="Ouvrir les présences"
            testID={STUDENT_SUB_SCREENS_TEST_IDS.openPresencesButton}
            onPress={() => openSubScreen("StudentPresences")}
          />
        ) : (
          <Text style={styles.info}>Lecture non autorisée.</Text>
        )}
      </ExpandableEntityCard>

      <ExpandableEntityCard
        title="Paiements"
        subtitle={paymentsDetail}
        badge=""
        testID={STUDENT_FICHE_LOT2_TEST_IDS.paymentsCard}
      >
        {canSeePayments ? (
          <StudentAction
            icon="card-outline"
            label="Paiements"
            detail={paymentsDetail}
            testID={STUDENT_SUB_SCREENS_TEST_IDS.openPaymentsButton}
            onPress={() => openSubScreen("StudentPayments")}
          />
        ) : (
          <Text style={styles.info}>Lecture non autorisée.</Text>
        )}
      </ExpandableEntityCard>
    </ScrollView>
  );
}

type StudentActionProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  testID?: string;
  onPress: () => void;
};

function StudentAction({ icon, label, detail, testID, onPress }: StudentActionProps) {
  return (
    <TouchableOpacity
      style={styles.menuButton}
      onPress={onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      <View style={styles.menuIcon}>
        <Ionicons name={icon} size={22} color="#2563EB" />
      </View>
      <View style={styles.menuContent}>
        <Text style={styles.menuText}>{label}</Text>
        <Text style={styles.menuDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward-outline" size={20} color="#CBD5E1" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: "#F8FAFC",
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  info: {
    fontSize: 14,
    marginBottom: 5,
    color: "#64748B",
    fontWeight: "700",
  },
  menuButton: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 20,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  menuContent: {
    flex: 1,
  },
  menuText: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },
  menuDetail: {
    marginTop: 3,
    color: "#64748B",
    fontWeight: "600",
  },
  guardianRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  archive: {
    color: "#B91C1C",
    fontWeight: "800",
  },
  input: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 12,
    marginBottom: 8,
    fontWeight: "700",
    color: "#0F172A",
  },
  create: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  createText: { color: "#FFFFFF", fontWeight: "900" },
  error: { color: "#B91C1C", fontWeight: "700", marginBottom: 8 },
});
