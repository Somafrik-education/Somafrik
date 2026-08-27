import { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import SchoolSelector from "../components/SchoolSelector";
import RoleDashboardLayout, {
  type RoleDashboardAction,
  type RoleDashboardKpi,
} from "../components/RoleDashboardLayout";
import { useAdminData } from "../context/AdminDataContext";
import { getPaymentCashKpi } from "../lib/paymentCashKpi";
import { getPaymentStats, getPresenceStats } from "../domain/metrics/schoolMetrics";
import { canReadEntity, canReadRoute, canReadView } from "../domain/security/permissions";
import { canAccessMessagesRoute } from "../lib/mobileCtaRbacAlignment";
import { buildOverflowQuickActionItems } from "../navigation/roleTabPreferences";
import { DATA_TRUTH_TEST_IDS, METRIC_PENDING_LABEL, metricLabelFromSnapshot, parentAverageDisplay } from "../lib/dataTruth";
import {
  ACTIVE_USERS_KPI_LABEL,
  PAYMENT_RATE_KPI_LABEL,
  PAYMENTS_KPI_LABEL,
  formatHomePaymentRateKpi,
  formatHomePaymentsKpi,
} from "../lib/homeDashboardKpis";
import { countActiveUserAccounts } from "../lib/format";
import { TODAY_PRESENCE_KPI_LABEL, getTodayEstablishmentPresenceKpi } from "../lib/todayPresenceKpi";
import { canonicalWeightedAverage, notesForStudent } from "../lib/evaluationsV2";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import {
  resolveTeacherAssignmentsForSession,
  scopedStudentsForSession,
  teacherScopedClassLabels,
} from "../lib/establishment";
import { HOME_TEST_IDS } from "../lib/loginScreenSpec";
import {
  canOpenHomeStudentDetail,
  canOpenHomeStudentNotes,
  canShowHomeCoursesKpi,
  canShowHomeNotesKpi,
  canShowHomePresenceKpi,
  canShowHomeStudentAction,
  homeCoursesRoute,
  homePresenceRoute,
} from "../lib/homeShellPermissions";
import {
  getRoleHomeShell,
  selectHomeKpis,
  type RoleHomeActionKey,
  type RoleHomeKpiKey,
} from "../lib/roleHomeConfig";

export default function HomeScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { session, selectedStudentId } = useAuth();
  const {
    studentsData,
    studentsSnapshot,
    paymentsData,
    paymentsSnapshot,
    loadPayments,
    studentFeesSnapshot,
    loadStudentFees,
    notesSnapshot,
    loadNotes,
    presencesData,
    presencesSnapshot,
    loadPresences,
    announcementsSnapshot,
    messagesSnapshot,
    loadAnnouncements,
    loadMessages,
    loadSchools,
    schoolsData,
    usersSnapshot,
    loadUsers,
    loadStudents,
    loadTeachers,
    loadClasses,
    loadAssignments,
    resourceScopeKey,
    countriesData,
    teachersData,
    assignmentsData,
    classesData,
    classesSnapshot,
    assignmentsSnapshot,
  } = useAdminData();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const teacherScopeState = {
    teachers: teachersData,
    assignments: assignmentsData,
    classes: classesData,
    assignmentsSource: assignmentsSnapshot.source,
  };
  const isPlatformAdmin = session?.role === "super_admin" || session?.role === "country_admin";
  const currentSchool =
    schoolsData.find((item) => item.code === session?.school?.code || item.code === session?.user.schoolCode) ??
    session?.school ??
    schoolsData[0] ??
    { name: "École", timezone: undefined, code: "" };

  const canonicalPayments =
    paymentsSnapshot.status === "success" || paymentsSnapshot.status === "empty" ? paymentsData : [];
  const paymentStats = getPaymentStats(canonicalPayments);
  const cashKpi = getPaymentCashKpi(canonicalPayments);
  const paymentsReady =
    paymentsSnapshot.status === "success" ||
    paymentsSnapshot.status === "empty" ||
    (paymentsSnapshot.status === "offline" && paymentsSnapshot.data.length > 0);

  const usersValue = metricLabelFromSnapshot(usersSnapshot, (rows) => String(countActiveUserAccounts(rows)));
  const studentsValue = metricLabelFromSnapshot(studentsSnapshot, (rows) => String(rows.length));
  const classesValue = metricLabelFromSnapshot(classesSnapshot, (rows) =>
    String(rows.length || new Set(studentsData.map((student) => student.className)).size),
  );
  const studentsReady =
    studentsSnapshot.status === "success" ||
    studentsSnapshot.status === "empty" ||
    (studentsSnapshot.status === "offline" && studentsSnapshot.data.length > 0);
  const presencesReady =
    presencesSnapshot.status === "success" ||
    presencesSnapshot.status === "empty" ||
    (presencesSnapshot.status === "offline" && presencesSnapshot.data.length > 0);
  const todayPresenceKpi = getTodayEstablishmentPresenceKpi({
    students: studentsData,
    presences: presencesData,
    schoolCode: currentSchool.code || session?.school?.code || session?.user?.schoolCode,
    timeZone: currentSchool.timezone,
  });
  const establishmentPresenceValue =
    studentsReady && presencesReady ? todayPresenceKpi.value : METRIC_PENDING_LABEL;
  const studentFeesReady =
    studentFeesSnapshot.status === "success" ||
    studentFeesSnapshot.status === "empty" ||
    (studentFeesSnapshot.status === "offline" && studentFeesSnapshot.data.length > 0);
  const paymentRateValue = metricLabelFromSnapshot(
    studentFeesSnapshot,
    (rows) => formatHomePaymentRateKpi(rows).value,
    METRIC_PENDING_LABEL,
  );
  const paymentsValue = metricLabelFromSnapshot(
    paymentsSnapshot,
    (rows) => formatHomePaymentsKpi(rows).value,
    "0",
  );
  const announcementsValue = metricLabelFromSnapshot(announcementsSnapshot, (rows) => String(rows.length));
  const unreadMessagesCount = getUnreadMessagesCount(session, messagesSnapshot.data, studentsData, teacherScopeState);
  const unreadMessagesValue = metricLabelFromSnapshot(messagesSnapshot, () => String(unreadMessagesCount));
  const unreadMessages = messagesSnapshot.status === "success" || messagesSnapshot.status === "empty" ? unreadMessagesCount : 0;
  const teachersValue = String(teachersData.length);
  const teacherStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);
  const teacherStudentIds = teacherStudents.map((student) => student.id);
  const teacherPresenceStats = getPresenceStats(
    presencesData.filter((presence) => isTodayPresence(presence.date)),
    teacherStudentIds,
  );
  const assignedClasses = teacherScopedClassLabels(session, teacherStudents, teacherScopeState);
  const sessionCourses = session?.user?.courses ?? [];
  const assignmentCourses = resolveTeacherAssignmentsForSession(session, teacherScopeState)
    .map((assignment) => String(assignment.course ?? "").trim())
    .filter(Boolean);
  const courses = [...new Set([...sessionCourses, ...assignmentCourses])];

  const linkedChild = session?.user?.children?.find((child: { id: string }) => child.id === selectedStudentId);
  const selectedStudent =
    studentsData.find((item) => item.id === selectedStudentId) ??
    (linkedChild ? { id: linkedChild.id, name: linkedChild.name, className: linkedChild.className } : undefined);
  const studentNotes = selectedStudentId ? notesForStudent(notesSnapshot.data, selectedStudentId) : [];
  const canonicalAverage = canonicalWeightedAverage(studentNotes);
  const averageDisplay = parentAverageDisplay({
    notesReady: notesSnapshot.status === "success" || notesSnapshot.status === "empty",
    notesForStudent: studentNotes,
    average: canonicalAverage.available ? canonicalAverage.average ?? undefined : undefined,
  });
  const studentPresences = presencesData.filter((presence) => presence.studentId === selectedStudentId);
  const studentPayments = paymentsReady ? paymentsData.filter((payment) => payment.studentId === selectedStudentId) : [];
  const studentPresenceStats = getPresenceStats(studentPresences);
  const studentPaymentStats = getPaymentStats(studentPayments);

  useFocusEffect(
    useCallback(() => {
      if (canReadEntity(session, "users")) void loadUsers();
      if (canReadEntity(session, "students")) void loadStudents();
      if (canReadEntity(session, "classes") || canReadRoute(session, "Classes")) void loadClasses();
      if (canReadRoute(session, "TeacherAttendance") || canReadEntity(session, "students")) void loadPresences();
      if (session?.role === "teacher" || canReadEntity(session, "teachers")) {
        void loadTeachers();
        void loadClasses();
      }
      if (session?.role === "teacher") void loadAssignments();
      if (canReadEntity(session, "payments")) {
        void loadPayments();
        void loadStudentFees();
      }
      if (canReadEntity(session, "announcements")) void loadAnnouncements();
      if (canReadEntity(session, "messages")) void loadMessages();
      if (session?.role === "super_admin" || session?.role === "country_admin") void loadSchools();
      if (session?.role === "parent_student" || session?.role === "student") void loadNotes();
    }, [
      session,
      resourceScopeKey,
      loadUsers,
      loadStudents,
      loadPresences,
      loadTeachers,
      loadClasses,
      loadAssignments,
      loadPayments,
      loadStudentFees,
      loadAnnouncements,
      loadMessages,
      loadSchools,
      loadNotes,
    ]),
  );

  const shell = getRoleHomeShell(session);
  const userName = session?.user?.name ?? "Utilisateur";
  const isTeacher = session?.role === "teacher";
  const isParentLike = session?.role === "parent_student" || session?.role === "student";

  const identityName = isParentLike ? selectedStudent?.name ?? "Élève" : userName;
  const identityContext = isTeacher
    ? assignedClasses.join(", ") || currentSchool.name
    : isParentLike
      ? selectedStudent?.className ?? currentSchool.name
      : currentSchool.name;

  const studentsRoute = canReadRoute(session, "TeacherStudents")
    ? "TeacherStudents"
    : canReadRoute(session, "Students")
      ? "Students"
      : "Classes";
  const usersRoute = "Users";
  const presenceRoute = homePresenceRoute(session, isParentLike);
  const canReadStudentPayments = canReadRoute(session, "StudentPayments");
  const paymentsRoute = isParentLike && canReadStudentPayments ? "StudentPayments" : "Payments";
  const canShowPaymentsKpi = isParentLike
    ? canReadStudentPayments
    : canReadEntity(session, "payments") || canReadStudentPayments;

  const kpiCatalog: Record<RoleHomeKpiKey, RoleDashboardKpi | null> = {
    users: canReadEntity(session, "users")
      ? kpi("users", "person-outline", usersValue, ACTIVE_USERS_KPI_LABEL, "#2563EB", "#EFF6FF", () => navigation.navigate(usersRoute), DATA_TRUTH_TEST_IDS.homeUsersValue)
      : null,
    classes: canReadEntity(session, "classes") || canReadRoute(session, "Classes")
      ? kpi("classes", "grid-outline", isTeacher ? String(assignedClasses.length) : classesValue, "Classes", "#2563EB", "#EFF6FF", () => navigation.navigate("Classes"))
      : null,
    students: canReadEntity(session, "students")
      ? kpi(
          "students",
          "people-outline",
          isTeacher ? String(teacherStudents.length) : studentsValue,
          "Élèves",
          "#7C3AED",
          "#F5F3FF",
          () => navigation.navigate(studentsRoute),
          DATA_TRUTH_TEST_IDS.homeStudentsValue,
        )
      : null,
    presence: canShowHomePresenceKpi(session)
      ? kpi(
          "presence",
          "checkmark-circle-outline",
          isParentLike
            ? `${studentPresenceStats.attended}/${studentPresenceStats.total}`
            : isTeacher
              ? `${teacherPresenceStats.rate}%`
              : establishmentPresenceValue,
          isParentLike || isTeacher ? "Présence" : TODAY_PRESENCE_KPI_LABEL,
          "#16A34A",
          "#ECFDF5",
          () =>
            navigation.navigate(
              presenceRoute,
              presenceRoute === "StudentPresences" ? { studentId: selectedStudentId } : undefined,
            ),
          DATA_TRUTH_TEST_IDS.homePresenceValue,
        )
      : null,
    payments: canShowPaymentsKpi
      ? kpi(
          "payments",
          "card-outline",
          isParentLike
            ? paymentsReady
              ? `${studentPaymentStats.paid}/${studentPaymentStats.total}`
              : "—"
            : paymentsValue,
          PAYMENTS_KPI_LABEL,
          "#EA580C",
          "#FFF7ED",
          () =>
            navigation.navigate(
              paymentsRoute,
              paymentsRoute === "StudentPayments" ? { studentId: selectedStudentId } : undefined,
            ),
          DATA_TRUTH_TEST_IDS.homePaymentsValue,
        )
      : null,
    paymentRate: canReadEntity(session, "payments")
      ? kpi(
          "paymentRate",
          "card-outline",
          studentFeesReady ? paymentRateValue : METRIC_PENDING_LABEL,
          PAYMENT_RATE_KPI_LABEL,
          "#EA580C",
          "#FFF7ED",
          () => navigation.navigate("Payments"),
        )
      : null,
    teachers: canReadEntity(session, "teachers")
      ? kpi("teachers", "school-outline", teachersValue, "Personnel", "#7C3AED", "#F5F3FF", () => navigation.navigate("Teachers"))
      : null,
    courses: canShowHomeCoursesKpi(session, isTeacher)
      ? kpi(
          "courses",
          "book-outline",
          isTeacher ? String(courses.length) : String(new Set(studentNotes.map((note) => note.subject).filter(Boolean)).size || "—"),
          "Cours",
          "#EA580C",
          "#FFF7ED",
          () => navigation.navigate(homeCoursesRoute(isTeacher)),
        )
      : null,
    notes: canShowHomeNotesKpi(session)
      ? kpi(
          "notes",
          "reader-outline",
          String(studentNotes.length),
          "Notes",
          "#7C3AED",
          "#F5F3FF",
          () => navigation.navigate("StudentNotes", { studentId: selectedStudentId }),
        )
      : null,
    average: canShowHomeNotesKpi(session)
      ? kpi(
          "average",
          "school-outline",
          averageDisplay.label,
          "Notes",
          "#2563EB",
          "#EFF6FF",
          () => navigation.navigate("StudentNotes", { studentId: selectedStudentId }),
          DATA_TRUTH_TEST_IDS.parentAverage,
        )
      : null,
    pendingPayments: canReadEntity(session, "payments")
      ? kpi("pendingPayments", "time-outline", paymentsReady ? formatAmount(paymentStats.pendingAmount) : "—", "À percevoir", "#EA580C", "#FFF7ED", () => navigation.navigate("Payments"))
      : null,
    paidPayments: canReadEntity(session, "payments")
      ? kpi("paidPayments", "checkmark-circle-outline", paymentsReady ? formatAmount(cashKpi.collectedAmount) : "—", "Encaissé", "#16A34A", "#ECFDF5", () => navigation.navigate("Payments"))
      : null,
    unpaidPayments: canReadEntity(session, "payments")
      ? kpi("unpaidPayments", "alert-circle-outline", paymentsReady ? String(paymentStats.pending) : "—", "Impayés", "#DC2626", "#FEF2F2", () => navigation.navigate("Payments"))
      : null,
    paymentCount: canReadEntity(session, "payments")
      ? kpi("paymentCount", "card-outline", paymentsValue, PAYMENTS_KPI_LABEL, "#EA580C", "#FFF7ED", () => navigation.navigate("Payments"), DATA_TRUTH_TEST_IDS.homePaymentsValue)
      : null,
    documents: canReadRoute(session, "Documents")
      ? kpi("documents", "folder-open-outline", "—", "Documents", "#2563EB", "#EFF6FF", () => navigation.navigate("Documents"))
      : null,
    messages: canAccessMessagesRoute(session)
      ? kpi("messages", "chatbubbles-outline", unreadMessagesValue, "Messages", "#0F766E", "#ECFDF5", () => navigation.navigate("Messages"))
      : null,
    announcements: canReadEntity(session, "announcements")
      ? kpi("announcements", "megaphone-outline", announcementsValue, "Annonces", "#7C3AED", "#F5F3FF", () => navigation.navigate("Announcements"))
      : null,
    countries: isPlatformAdmin
      ? kpi("countries", "earth-outline", String(countriesData.length), "Pays", "#2563EB", "#EFF6FF", () => navigation.navigate("AdminCrud", { entity: "countries" }))
      : null,
    schools: isPlatformAdmin
      ? kpi("schools", "business-outline", String(schoolsData.length), "Établissements", "#7C3AED", "#F5F3FF", () => navigation.navigate("AdminCrud", { entity: "schools" }))
      : null,
  };

  const kpis = selectHomeKpis(
    shell.kpiKeys.map((key) => kpiCatalog[key]).filter((item): item is RoleDashboardKpi => Boolean(item)),
  );

  const actionCatalog: Record<RoleHomeActionKey, RoleDashboardAction | null> = {
    users: canReadEntity(session, "users") ? action("users", "person-circle-outline", "Utilisateurs", () => navigation.navigate("Users")) : null,
    classes: canReadRoute(session, "Classes") ? action("classes", "grid-outline", "Classes", () => navigation.navigate("Classes")) : null,
    teachers: canReadEntity(session, "teachers") ? action("teachers", "person-add-outline", "Enseignants", () => navigation.navigate("Teachers")) : null,
    payments: canReadEntity(session, "payments") ? action("payments", "card-outline", "Paiements", () => navigation.navigate("Payments")) : null,
    platformNotifications: canReadView(session, "PlatformNotifications")
      ? action("platformNotifications", "notifications-outline", "Notifications", () => navigation.navigate("PlatformNotifications"))
      : null,
    announcements: canReadEntity(session, "announcements") ? action("announcements", "megaphone-outline", "Annonces", () => navigation.navigate("Announcements")) : null,
    students: canReadEntity(session, "students") ? action("students", "people-outline", "Élèves", () => navigation.navigate(studentsRoute)) : null,
    attendance: canReadRoute(session, "TeacherAttendance") ? action("attendance", "checkbox-outline", "Présences", () => navigation.navigate("TeacherAttendance")) : null,
    grades: canReadRoute(session, "TeacherGrades") ? action("grades", "reader-outline", "Notes", () => navigation.navigate("TeacherGrades")) : null,
    reportCards: canReadRoute(session, "ReportCards") ? action("reportCards", "document-text-outline", "Bulletins", () => navigation.navigate("ReportCards")) : null,
    messages: canAccessMessagesRoute(session)
      ? action("messages", "chatbubbles-outline", unreadMessages > 0 ? `Messages (${unreadMessages})` : "Messages", () => navigation.navigate("Messages"))
      : null,
    timetable: canReadRoute(session, "Timetable") ? action("timetable", "time-outline", "Planning", () => navigation.navigate("Timetable")) : null,
    profile: canShowHomeStudentAction(session, "profile", selectedStudentId)
      ? action("profile", "person-outline", "Profil", () => navigation.navigate("StudentDetail", { studentId: selectedStudentId }))
      : null,
    notes: canShowHomeStudentAction(session, "notes", selectedStudentId)
      ? action("notes", "book-outline", "Notes", () => navigation.navigate("StudentNotes", { studentId: selectedStudentId }))
      : null,
    presences: canShowHomeStudentAction(session, "presences", selectedStudentId)
      ? action("presences", "calendar-outline", "Présences", () => navigation.navigate("StudentPresences", { studentId: selectedStudentId }))
      : null,
    studentPayments: canShowHomeStudentAction(session, "studentPayments", selectedStudentId)
      ? action("studentPayments", "card-outline", "Paiements", () => navigation.navigate("StudentPayments", { studentId: selectedStudentId }))
      : null,
    documents: canReadRoute(session, "Documents") ? action("documents", "folder-open-outline", "Documents", () => navigation.navigate("Documents")) : null,
  };

  const configuredActions = shell.actionKeys
    .map((key) => actionCatalog[key])
    .filter((item): item is RoleDashboardAction => Boolean(item));
  const configuredKeys = new Set(configuredActions.map((item) => item.key));
  const overflowActions = buildOverflowQuickActionItems(session)
    .filter((item) => !configuredKeys.has(item.tabName) && !configuredActions.some((action) => action.label === item.label))
    .map((item) => action(item.tabName, item.icon, item.label, () => navigation.navigate(item.tabName)));
  const actions = [...configuredActions, ...overflowActions];

  const dashboardTestId =
    session?.role === "school_admin"
      ? HOME_TEST_IDS.adminDashboard
      : session?.role === "teacher"
        ? HOME_TEST_IDS.teacherDashboard
        : session?.role === "parent_student" || session?.role === "student"
          ? HOME_TEST_IDS.parentDashboard
          : undefined;

  const latestAnnouncement = announcementsSnapshot.data[0];
  const showParentAnnouncement = isParentLike && Boolean(latestAnnouncement || canReadRoute(session, "Announcements"));

  return (
    <RoleDashboardLayout
      paddingBottom={scrollContentPaddingBottom}
      paddingHorizontal={isTablet ? horizontalPadding : 12}
      contentMaxWidth={contentMaxWidth}
      headerSlot={
        isPlatformAdmin ? (
          <SchoolSelector />
        ) : isParentLike ? (
          <StudentSwitcher />
        ) : null
      }
      identity={{
        name: identityName,
        context: identityContext,
        spaceLabel: shell.spaceLabel,
        icon: shell.identityIcon as keyof typeof Ionicons.glyphMap,
        accent: shell.accent,
        onPress: () => {
          if (canOpenHomeStudentDetail(session, selectedStudentId)) {
            navigation.navigate("StudentDetail", { studentId: selectedStudentId });
            return;
          }
          if (canReadRoute(session, "Classes")) navigation.navigate("Classes");
        },
      }}
      banner={{
        title: shell.spaceLabel,
        mission: shell.mission,
        icon: shell.bannerIcon as keyof typeof Ionicons.glyphMap,
        background: shell.accent,
        onPress: () => {
          if (canOpenHomeStudentNotes(session, selectedStudentId)) {
            navigation.navigate("StudentNotes", { studentId: selectedStudentId });
            return;
          }
          if (canReadRoute(session, "TeacherAttendance")) {
            navigation.navigate("TeacherAttendance");
            return;
          }
          if (canReadRoute(session, "Classes")) navigation.navigate("Classes");
        },
        testID: dashboardTestId,
      }}
      kpis={kpis}
      actions={actions}
      showSecurityMatrix={shell.showSecurityMatrix && canReadView(session, "Permissions")}
      onSecurityMatrixPress={() => navigation.navigate("Permissions")}
      footerSlot={
        showParentAnnouncement ? (
          <View style={footerStyles.wrap}>
            <Text style={footerStyles.title}>Dernière annonce</Text>
            <TouchableOpacity style={footerStyles.card} onPress={() => navigation.navigate("Announcements")}>
              <Text style={footerStyles.cardTitle}>{latestAnnouncement?.title ?? "Aucune annonce"}</Text>
              <Text style={footerStyles.cardBody}>
                {latestAnnouncement?.message ?? "Les annonces de l'école apparaîtront ici."}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null
      }
    />
  );
}

function kpi(
  key: RoleHomeKpiKey,
  icon: keyof typeof Ionicons.glyphMap,
  value: string,
  label: string,
  color: string,
  bg: string,
  onPress?: () => void,
  testID?: string,
): RoleDashboardKpi {
  return { key, icon, value, label, color, bg, onPress, testID };
}

function action(
  key: string,
  icon: keyof typeof Ionicons.glyphMap,
  label: string,
  onPress: () => void,
): RoleDashboardAction {
  return { key, icon, label, onPress };
}

function formatAmount(value: number) {
  return `${Math.round(value).toLocaleString("fr-FR")} F`;
}

function isTodayPresence(dateValue?: string) {
  return toDateKey(dateValue) === toDateKey(new Date());
}

function toDateKey(value?: string | Date) {
  if (!value) return "";
  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const localMatch = text.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (localMatch) return `${localMatch[3]}-${localMatch[2]}-${localMatch[1]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return toDateKey(parsed);
}

function getUnreadMessagesCount(
  session: any,
  messagesData: any[],
  studentsData: any[],
  teacherScopeState?: { teachers?: any[]; assignments?: any[]; classes?: any[] },
) {
  if (
    session?.role === "super_admin" ||
    session?.role === "school_admin" ||
    session?.role === "country_admin" ||
    session?.role === "principal" ||
    session?.role === "proviseur" ||
    session?.role === "prefet" ||
    session?.role === "secretary" ||
    session?.role === "accountant" ||
    session?.role === "adjoint"
  ) {
    return messagesData.filter(
      (message) => message.status === "Nouveau" && message.direction === "Parent vers école",
    ).length;
  }
  if (session?.role === "teacher") {
    const teacherStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);
    const teacherParents = teacherStudents.map((student) => student.parentPhone);
    return messagesData.filter(
      (message) =>
        message.status === "Nouveau" &&
        (message.teacherId === session.user.id || teacherParents.includes(message.parentPhone)) &&
        message.direction === "Parent vers enseignant",
    ).length;
  }
  const parentPhone = session?.user.parentPhone ?? session?.user.children?.[0]?.parentPhone;
  return messagesData.filter(
    (message) =>
      message.status === "Nouveau" &&
      message.parentPhone === parentPhone &&
      (message.direction === "École vers parent" || message.direction === "Enseignant vers parent"),
  ).length;
}

const footerStyles = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: "800", color: "#0F172A", marginBottom: 8 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  cardBody: { marginTop: 4, fontSize: 13, fontWeight: "600", color: "#64748B" },
});