import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";

const somafrikLogo = require("../../assets/somafrik-logo.png");
import StudentSwitcher from "../components/StudentSwitcher";
import { useAdminData } from "../context/AdminDataContext";
import { getPaymentStats, getPresenceStats } from "../domain/metrics/schoolMetrics";
import { canReadEntity, canReadRoute } from "../domain/security/permissions";
import { buildOverflowQuickActionItems } from "../navigation/roleTabPreferences";
import { DATA_TRUTH_TEST_IDS, isMetricReady, metricLabelFromSnapshot, parentAverageDisplay } from "../lib/dataTruth";
import { canonicalWeightedAverage, notesForStudent } from "../lib/evaluationsV2";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import SchoolSelector from "../components/SchoolSelector";
import CommunicationHeaderIcons from "../components/CommunicationHeaderIcons";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import {
  resolveTeacherAssignmentsForSession,
  scopedStudentsForSession,
  teacherScopedClassLabels,
} from "../lib/establishment";
import { HOME_TEST_IDS } from "../lib/loginScreenSpec";
import { NAVIGATION_COPY, NAVIGATION_TEST_IDS } from "../lib/mobileNavigationSpec";

export default function HomeScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { session, selectedStudentId } = useAuth();
  const {
    studentsData,
    studentsSnapshot,
    paymentsData,
    paymentsSnapshot,
    loadPayments,
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
    resourceScopeKey,
    countriesData,
    subscriptionsData,
    teachersData,
    assignmentsData,
    classesData,
    classesSnapshot,
  } = useAdminData();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const scrollContentStyle = [
    styles.scrollContent,
    {
      paddingBottom: scrollContentPaddingBottom,
      paddingHorizontal: horizontalPadding,
      maxWidth: contentMaxWidth,
      alignSelf: "center" as const,
      width: "100%" as const,
    },
  ];
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const isPlatformAdmin = session?.role === "super_admin" || session?.role === "country_admin";
  const currentSchool =
    schoolsData.find((item) => item.code === session?.school?.code || item.code === session?.user.schoolCode) ??
    session?.school ??
    schoolsData[0] ??
    { name: "École", timezone: undefined, code: "" };
  const studentIds = studentsData.map((student) => student.id);
  const todayPresenceRows = presencesData.filter((presence) => isTodayPresence(presence.date));
  const presenceStats = getPresenceStats(todayPresenceRows, studentIds);
  const attendanceCallCount = countAttendanceCalls(todayPresenceRows, studentsData);
  const paymentStats = getPaymentStats(paymentsSnapshot.status === "success" || paymentsSnapshot.status === "empty" ? paymentsData : [], studentIds);
  const usersValue = metricLabelFromSnapshot(usersSnapshot, (rows) =>
    String(rows.filter(isActiveUserAccount).length),
  );
  const studentsValue = metricLabelFromSnapshot(studentsSnapshot, (rows) => String(rows.length));
  const presenceValue = metricLabelFromSnapshot(presencesSnapshot, () => `${presenceStats.rate}%`, "0%");
  const paymentsValue = metricLabelFromSnapshot(paymentsSnapshot, () => `${paymentStats.rate}%`, "0%");
  const paymentsReady =
    paymentsSnapshot.status === "success" ||
    paymentsSnapshot.status === "empty" ||
    (paymentsSnapshot.status === "offline" && paymentsSnapshot.data.length > 0);
  const presenceMeta = metricLabelFromSnapshot(
    presencesSnapshot,
    () => `${attendanceCallCount} appel(s) • ${presenceStats.attended}/${presenceStats.total} élève(s)`,
    "0 appel(s)",
  );
  const announcementsValue = metricLabelFromSnapshot(announcementsSnapshot, (rows) => String(rows.length));
  const messagesValue = metricLabelFromSnapshot(messagesSnapshot, (rows) => String(rows.length));
  const unreadMessagesCount = getUnreadMessagesCount(session, messagesSnapshot.data, studentsData, teacherScopeState);
  const unreadMessagesValue = metricLabelFromSnapshot(messagesSnapshot, () => String(unreadMessagesCount));
  const unreadMessages = isMetricReady(messagesSnapshot) ? unreadMessagesCount : 0;
  const userName = session?.user.name ?? "Administrateur";
  const welcomeGreeting = buildTimeGreeting(currentSchool.timezone);
  const welcomeName = getGreetingName(userName, session?.role);
  const canReadStudents = canReadEntity(session, "students");
  const canReadUsers = canReadEntity(session, "users");
  const canReadPayments = canReadEntity(session, "payments");
  const canReadAnnouncements = canReadEntity(session, "announcements");
  const canReadMessages = canReadEntity(session, "messages");
  const canReadAttendance = canReadRoute(session, "TeacherAttendance");
  const canOpenSchoolManagement = canReadRoute(session, "SchoolManagement");
  const isSchoolAdmin = session?.role === "school_admin";
  const openUsers = () => navigation.navigate(isSchoolAdmin ? "Utilisateurs" : "Users");

  useFocusEffect(
    useCallback(() => {
      if (canReadEntity(session, "users")) {
        void loadUsers();
      }
      if (canReadEntity(session, "students")) {
        void loadStudents();
      }
      if (canReadRoute(session, "TeacherAttendance") || canReadEntity(session, "students")) {
        void loadPresences();
      }
      if (session?.role === "teacher") {
        void loadTeachers();
        void loadClasses();
      }
      if (canReadEntity(session, "payments")) {
        void loadPayments();
      }
      if (canReadEntity(session, "announcements")) {
        void loadAnnouncements();
      }
      if (canReadEntity(session, "messages")) {
        void loadMessages();
      }
      if (session?.role === "super_admin" || session?.role === "country_admin") {
        void loadSchools();
      }
      if (session?.role === "parent_student" || session?.role === "student") {
        void loadNotes();
      }
    }, [session, resourceScopeKey, loadUsers, loadStudents, loadPresences, loadTeachers, loadClasses, loadPayments, loadAnnouncements, loadMessages, loadSchools, loadNotes]),
  );

  if (session?.role === "teacher") {
    const teacherStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);
    const assignedClasses = teacherScopedClassLabels(session, teacherStudents, teacherScopeState);
    const sessionCourses = session.user.courses ?? [];
    const assignmentCourses = resolveTeacherAssignmentsForSession(session, assignmentsData)
      .map((assignment) => String(assignment.course ?? "").trim())
      .filter(Boolean);
    const courses = [...new Set([...sessionCourses, ...assignmentCourses])];
    const teacherStudentIds = teacherStudents.map((student) => student.id);
    const teacherTodayPresenceRows = presencesData.filter((presence) => isTodayPresence(presence.date));
    const teacherPresenceStats = getPresenceStats(teacherTodayPresenceRows, teacherStudentIds);
    const teacherAttendanceCallCount = countAttendanceCalls(teacherTodayPresenceRows, teacherStudents);
    const teacherStudentsValue = metricLabelFromSnapshot(studentsSnapshot, () => String(teacherStudents.length));
    const teacherClassesValue = metricLabelFromSnapshot(classesSnapshot, () => String(assignedClasses.length));
    const teacherPresenceValue = metricLabelFromSnapshot(presencesSnapshot, () => `${teacherPresenceStats.rate}%`, "0%");
    const teacherPresenceMeta = metricLabelFromSnapshot(
      presencesSnapshot,
      () => `${teacherAttendanceCallCount} appel(s) • ${teacherPresenceStats.attended}/${teacherPresenceStats.total} élève(s)`,
      "0 appel(s)",
    );

    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={scrollContentStyle}
        >
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.schoolCard}
            onPress={() => navigation.navigate("Classes")}
          >
            <View style={styles.schoolIconBox}>
              <Ionicons name="school-outline" size={28} color="#2563EB" />
            </View>

            <View style={styles.schoolInfo}>
              <Text style={styles.schoolName}>{userName}</Text>
              <Text style={styles.schoolCity}>{courses.join(", ") || "Cours non renseignés"}</Text>
              <Text style={styles.schoolTagline}>{assignedClasses.join(", ") || currentSchool.name}</Text>
            </View>
          </TouchableOpacity>

          <CommunicationHeaderIcons navigation={navigation} unreadMessages={unreadMessages} />

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.teacherWelcomeCard}
            onPress={() => navigation.navigate("TeacherAttendance")}
            testID={HOME_TEST_IDS.teacherDashboard}
          >
            <View>
              <Text style={styles.welcomeTitle}>Espace enseignant</Text>
              <Text style={styles.welcomeText}>
                Suivez vos classes, l'appel et les résultats des élèves.
              </Text>
            </View>

            <View style={styles.welcomeIcon}>
              <Ionicons name="reader-outline" size={28} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Mes classes</Text>
            <Text style={styles.sectionLink}>Aujourd'hui</Text>
          </View>

          <View style={styles.statsGrid}>
            <StatCard
              icon="grid-outline"
              value={teacherClassesValue}
              label="Classes"
              color="#2563EB"
              bg="#EFF6FF"
              onPress={() => navigation.navigate("Classes")}
            />
            <StatCard
              icon="people-outline"
              value={teacherStudentsValue}
              label="Élèves"
              color="#7C3AED"
              bg="#F5F3FF"
              onPress={() => navigation.navigate("TeacherStudents")}
            />
            <StatCard
              icon="checkmark-circle-outline"
              value={teacherPresenceValue}
              label="Présence"
              meta={teacherPresenceMeta === "—" || teacherPresenceMeta === "Indisponible" ? undefined : teacherPresenceMeta}
              color="#16A34A"
              bg="#ECFDF5"
              onPress={() => navigation.navigate("TeacherAttendance")}
              testID={DATA_TRUTH_TEST_IDS.homePresenceValue}
            />
            <StatCard
              icon="book-outline"
              value={String(courses.length)}
              label="Cours"
              color="#EA580C"
              bg="#FFF7ED"
              onPress={() => navigation.navigate("TeacherGrades")}
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Actions rapides</Text>
          </View>

          <View style={styles.actionsGrid}>
            <QuickAction
              icon="grid-outline"
              label="Classes"
              onPress={() => navigation.navigate("Classes")}
            />
            <QuickAction
              icon="people-outline"
              label="Élèves"
              onPress={() => navigation.navigate("TeacherStudents")}
            />
            <QuickAction
              icon="checkbox-outline"
              label="Appel"
              onPress={() => navigation.navigate("TeacherAttendance")}
            />
            {canReadRoute(session, "TeacherGrades") && (
              <QuickAction
                icon="reader-outline"
                label="Notes"
                onPress={() => navigation.navigate("TeacherGrades")}
              />
            )}
            {canReadRoute(session, "Timetable") && (
              <QuickAction
                icon="time-outline"
                label="Planning"
                onPress={() => navigation.navigate("Timetable")}
              />
            )}
            {canReadRoute(session, "ReportCards") && (
              <QuickAction
                icon="document-text-outline"
                label="Bulletins"
                onPress={() => navigation.navigate("ReportCards")}
              />
            )}
            {canReadRoute(session, "Messages") && (
              <QuickAction
                icon="chatbubbles-outline"
                label={unreadMessages > 0 ? `Messages (${unreadMessages})` : "Messages"}
                onPress={() => navigation.navigate("Messages")}
              />
            )}
            <OverflowQuickActionsGrid
              session={session}
              navigation={navigation}
              unreadMessages={unreadMessages}
              excludeTabNames={["Classes", "TeacherStudents", "TeacherAttendance", "TeacherGrades"]}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  if ((session?.role === "parent_student" || session?.role === "student") && selectedStudentId) {
    const linkedChild = session.user.children?.find((child) => child.id === selectedStudentId);
    const student =
      studentsData.find((item) => item.id === selectedStudentId) ??
      (linkedChild
        ? { id: linkedChild.id, name: linkedChild.name, className: linkedChild.className }
        : undefined);
    const studentNotes = notesForStudent(notesSnapshot.data, selectedStudentId);
    const canonicalAverage = canonicalWeightedAverage(studentNotes);
    const averageDisplay = parentAverageDisplay({
      notesReady: notesSnapshot.status === "success" || notesSnapshot.status === "empty",
      notesForStudent: studentNotes,
      average: canonicalAverage.available ? canonicalAverage.average ?? undefined : undefined,
    });
    const studentPresences = presencesData.filter((presence) => presence.studentId === selectedStudentId);
    const studentPayments = paymentsReady
      ? paymentsData.filter((payment) => payment.studentId === selectedStudentId)
      : [];
    const studentPresenceStats = getPresenceStats(studentPresences);
    const studentPaymentStats = getPaymentStats(studentPayments);
    const latestAnnouncement = announcementsSnapshot.data[0];

    return (
      <View style={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={scrollContentStyle}
        >
          <StudentSwitcher />

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.schoolCard}
            onPress={() => navigation.navigate("StudentDetail", { studentId: selectedStudentId })}
          >
            <View style={styles.schoolIconBox}>
              <Ionicons name="person-circle-outline" size={30} color="#2563EB" />
            </View>

            <View style={styles.schoolInfo}>
              <Text style={styles.schoolName}>{student?.name ?? "Élève"}</Text>
              <Text style={styles.schoolCity}>{student?.className ?? "Classe non renseignée"}</Text>
              <Text style={styles.schoolTagline}>{currentSchool.name}</Text>
            </View>
          </TouchableOpacity>

          <CommunicationHeaderIcons navigation={navigation} unreadMessages={unreadMessages} />

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.parentWelcomeCard}
            onPress={() => navigation.navigate("StudentNotes", { studentId: selectedStudentId })}
            testID={HOME_TEST_IDS.parentDashboard}
          >
            <View>
              <Text style={styles.welcomeTitle}>
                {session.role === "student" ? "Espace élève" : "Suivi scolaire"}
              </Text>
              <Text style={styles.welcomeText}>
                Consultez les résultats, présences et paiements de l'élève.
              </Text>
            </View>

            <View style={styles.welcomeIcon}>
              <Ionicons name="book-outline" size={28} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Résumé de l'élève</Text>
            <Text style={styles.sectionLink}>Aujourd'hui</Text>
          </View>

          <View style={styles.statsGrid}>
            <StatCard
              icon="school-outline"
              value={averageDisplay.label}
              label="Moyenne"
              color="#2563EB"
              bg="#EFF6FF"
              testID={DATA_TRUTH_TEST_IDS.parentAverage}
              onPress={() => navigation.navigate("StudentNotes", { studentId: selectedStudentId })}
            />

            <StatCard
              icon="checkmark-circle-outline"
              value={`${studentPresenceStats.attended}/${studentPresenceStats.total}`}
              label="Présences"
              color="#16A34A"
              bg="#ECFDF5"
              onPress={() => navigation.navigate("StudentPresences", { studentId: selectedStudentId })}
            />

            <StatCard
              icon="document-text-outline"
              value={String(studentNotes.length)}
              label="Notes"
              color="#7C3AED"
              bg="#F5F3FF"
              onPress={() => navigation.navigate("StudentNotes", { studentId: selectedStudentId })}
            />

            <StatCard
              icon="card-outline"
              value={paymentsReady ? `${studentPaymentStats.paid}/${studentPaymentStats.total}` : "—"}
              label="Paiements"
              color="#EA580C"
              bg="#FFF7ED"
              onPress={() => navigation.navigate("StudentPayments", { studentId: selectedStudentId })}
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Accès rapides</Text>
          </View>

          <View style={styles.actionsGrid}>
            <QuickAction
              icon="person-outline"
              label="Profil"
              onPress={() => navigation.navigate("StudentDetail", { studentId: selectedStudentId })}
            />
            <QuickAction
              icon="book-outline"
              label="Notes"
              onPress={() => navigation.navigate("StudentNotes", { studentId: selectedStudentId })}
            />
            <QuickAction
              icon="calendar-outline"
              label="Présences"
              onPress={() => navigation.navigate("StudentPresences", { studentId: selectedStudentId })}
            />
            {canReadRoute(session, "Timetable") && (
              <QuickAction
                icon="time-outline"
                label="Emploi du temps"
                onPress={() => navigation.navigate("Timetable")}
              />
            )}
            {canReadRoute(session, "ReportCards") && (
              <QuickAction
                icon="document-text-outline"
                label="Bulletins"
                onPress={() => navigation.navigate("ReportCards")}
              />
            )}
            <QuickAction
              icon="card-outline"
              label="Paiements"
              onPress={() => navigation.navigate("StudentPayments", { studentId: selectedStudentId })}
            />
            {session.role === "parent_student" && canReadRoute(session, "Messages") && (
              <QuickAction
                icon="chatbubbles-outline"
                label={unreadMessages > 0 ? `Messages (${unreadMessages})` : "Messages"}
                onPress={() => navigation.navigate("Messages")}
              />
            )}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Dernière annonce</Text>
          </View>

          <View style={styles.activityCard}>
            <ActivityItem
              icon="megaphone-outline"
              title={latestAnnouncement?.title ?? "Aucune annonce"}
              description={latestAnnouncement?.message ?? "Les annonces de l'école apparaîtront ici."}
              color="#7C3AED"
              onPress={() => navigation.navigate("Announcements")}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (session?.role === "principal" || session?.role === "prefet" || session?.role === "secretary") {
    const isSecretary = session.role === "secretary";
    const title = isSecretary ? "Espace secrétariat" : session.role === "prefet" ? "Espace préfet des études" : "Espace proviseur";
    const description = isSecretary
      ? "Suivi des élèves, présences, paiements et messages administratifs."
      : "Pilotage pédagogique, présences, notes, bulletins et rapports.";

    return (
      <View style={styles.screen}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={scrollContentStyle}>
          <TouchableOpacity activeOpacity={0.85} style={styles.schoolCard} onPress={() => navigation.navigate("Classes")}>
            <View style={styles.schoolIconBox}>
              <Ionicons name={isSecretary ? "briefcase-outline" : "analytics-outline"} size={28} color="#2563EB" />
            </View>
            <View style={styles.schoolInfo}>
              <Text style={styles.schoolName}>{userName}</Text>
              <Text style={styles.schoolCity}>{currentSchool.name}</Text>
              <Text style={styles.schoolTagline}>{title}</Text>
            </View>
          </TouchableOpacity>

          <CommunicationHeaderIcons navigation={navigation} unreadMessages={unreadMessages} />

          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.welcomeCard}
            onPress={() => navigation.navigate(isSecretary ? "TeacherStudents" : "TeacherAttendance")}
          >
            <View>
              <Text style={styles.welcomeTitle}>{title}</Text>
              <Text style={styles.welcomeText}>{description}</Text>
            </View>
            <View style={styles.welcomeIcon}>
              <Ionicons name={isSecretary ? "people-outline" : "school-outline"} size={28} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Vue métier</Text>
            <Text style={styles.sectionLink}>Matrice sécurité</Text>
          </View>

          <View style={styles.statsGrid}>
            {canReadEntity(session, "classes") && (
              <StatCard icon="grid-outline" value={String(studentsData.length ? new Set(studentsData.map((student) => student.className)).size : 0)} label="Classes" color="#2563EB" bg="#EFF6FF" onPress={() => navigation.navigate("Classes")} />
            )}
            {canReadEntity(session, "students") && (
              <StatCard icon="people-outline" value={String(studentsData.length)} label="Élèves" color="#7C3AED" bg="#F5F3FF" onPress={() => navigation.navigate("TeacherStudents")} />
            )}
            {canReadRoute(session, "TeacherAttendance") && (
              <StatCard
                icon="checkmark-circle-outline"
                value={`${presenceStats.rate}%`}
                label="Présence"
                meta={`${attendanceCallCount} appel(s) • ${presenceStats.attended}/${presenceStats.total} élève(s)`}
                color="#16A34A"
                bg="#ECFDF5"
                onPress={() => navigation.navigate("TeacherAttendance")}
              />
            )}
            {canReadEntity(session, "payments") && (
              <StatCard icon="card-outline" value={paymentsReady ? `${paymentStats.rate}%` : "—"} label="Paiements" color="#EA580C" bg="#FFF7ED" onPress={() => navigation.navigate("Payments")} />
            )}
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Actions rapides</Text>
          </View>

          <View style={styles.actionsGrid}>
            {canReadEntity(session, "students") && <QuickAction icon="people-outline" label="Élèves" onPress={() => navigation.navigate("TeacherStudents")} />}
            {canReadRoute(session, "TeacherAttendance") && <QuickAction icon="checkbox-outline" label="Présences" onPress={() => navigation.navigate("TeacherAttendance")} />}
            {canReadRoute(session, "TeacherGrades") && <QuickAction icon="reader-outline" label="Notes" onPress={() => navigation.navigate("TeacherGrades")} />}
            {canReadRoute(session, "ReportCards") && <QuickAction icon="document-text-outline" label="Bulletins" onPress={() => navigation.navigate("ReportCards")} />}
            {canReadEntity(session, "payments") && <QuickAction icon="card-outline" label="Paiements" onPress={() => navigation.navigate("Payments")} />}
            {canReadRoute(session, "Messages") && <QuickAction icon="chatbubbles-outline" label={unreadMessages > 0 ? `Messages (${unreadMessages})` : "Messages"} onPress={() => navigation.navigate("Messages")} />}
            {canReadRoute(session, "Announcements") && <QuickAction icon="megaphone-outline" label="Annonces" onPress={() => navigation.navigate("Announcements")} />}
            <OverflowQuickActionsGrid
              session={session}
              navigation={navigation}
              unreadMessages={unreadMessages}
              excludeTabNames={["TeacherStudents", "TeacherAttendance", "TeacherGrades", "Paiements", "Messages"]}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={scrollContentStyle}
      >
        {/* Header Somafrik
        <View style={styles.topHeader}>
          <View>
            <Text style={styles.brand}>Somafrik</Text>
            <Text style={styles.subtitle}>Smart Education Platform</Text>
          </View>

          <View style={styles.avatar}>
            <Text style={styles.avatarText}>U</Text>
          </View>
        </View> */}

        {/* Établissement */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.schoolCard}
          onPress={() => canOpenSchoolManagement && navigation.navigate("SchoolManagement")}
        >
          <View style={styles.schoolIconBox}>
            {currentSchool.logoUrl ? (
              <Image source={{ uri: currentSchool.logoUrl }} style={styles.schoolLogoImage} />
            ) : (
              <Image source={somafrikLogo} style={styles.schoolLogoImage} />
            )}
          </View>

          <View style={styles.schoolInfo}>
            <Text style={styles.schoolName}>{currentSchool.name}</Text>
            <Text style={styles.schoolCity}>{currentSchool.city}</Text>
            <Text style={styles.schoolTagline}>{currentSchool.slogan}</Text>
          </View>
        </TouchableOpacity>

        <CommunicationHeaderIcons navigation={navigation} unreadMessages={unreadMessages} />

        {isPlatformAdmin && <SchoolSelector />}

        {isPlatformAdmin && (
          <View style={[styles.statsGrid, isTablet && styles.statsGridTablet]}>
            <StatCard
              icon="earth-outline"
              value={String(countriesData.length)}
              label="Pays"
              color="#2563EB"
              bg="#EFF6FF"
              onPress={() => navigation.navigate("AdminCrud", { entity: "countries" })}
            />
            <StatCard
              icon="business-outline"
              value={String(schoolsData.length)}
              label="Etablissements"
              color="#7C3AED"
              bg="#F5F3FF"
              onPress={() => navigation.navigate("AdminCrud", { entity: "schools" })}
            />
            <StatCard
              icon="cube-outline"
              value={String(subscriptionsData.length)}
              label="Abonnements"
              color="#EA580C"
              bg="#FFF7ED"
              onPress={() => navigation.navigate("AdminCrud", { entity: "subscriptions" })}
            />
            <StatCard
              icon="people-outline"
              value={usersValue}
              label="Admins etablissement"
              color="#16A34A"
              bg="#ECFDF5"
              onPress={() => navigation.navigate("Users")}
              testID={DATA_TRUTH_TEST_IDS.homeUsersValue}
            />
          </View>
        )}

        {/* Bienvenue */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.welcomeCard}
          onPress={() => canOpenSchoolManagement && navigation.navigate("SchoolManagement")}
          testID={isSchoolAdmin ? HOME_TEST_IDS.adminDashboard : undefined}
        >
          <View>
            <Text style={styles.welcomeTitle}>
              {welcomeGreeting}{welcomeName ? ` ${welcomeName}` : ""}
            </Text>
          </View>

          <View style={styles.welcomeIcon}>
            <Ionicons name="grid-outline" size={28} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {/* Statistiques */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle} testID={NAVIGATION_TEST_IDS.homeOverviewTitle}>
            {NAVIGATION_COPY.homeOverview}
          </Text>
          <Text style={styles.sectionLink}>Aujourd’hui</Text>
        </View>

        <View style={styles.statsGrid}>
          {canReadUsers && (
            <StatCard
              icon="person-outline"
              value={usersValue}
              label="Utilisateurs"
              meta="Comptes actifs"
              color="#2563EB"
              bg="#EFF6FF"
              onPress={openUsers}
              testID={DATA_TRUTH_TEST_IDS.homeUsersValue}
            />
          )}

          {!isSchoolAdmin && canReadStudents && (
            <StatCard
              icon="people-outline"
              value={studentsValue}
              label="Élèves"
              color="#7C3AED"
              bg="#F5F3FF"
              onPress={() => navigation.navigate("Students")}
              testID={DATA_TRUTH_TEST_IDS.homeStudentsValue}
            />
          )}

          {canReadAttendance && (
            <StatCard
              icon="checkmark-circle-outline"
              value={presenceValue}
              label="Présence"
              meta={presenceMeta === "—" || presenceMeta === "Indisponible" ? undefined : presenceMeta}
              color="#16A34A"
              bg="#ECFDF5"
              onPress={() => navigation.navigate("TeacherAttendance")}
              testID={DATA_TRUTH_TEST_IDS.homePresenceValue}
            />
          )}

          {canReadPayments && (
            <StatCard
              icon="card-outline"
              value={paymentsValue}
              label="Paiements"
              color="#EA580C"
              bg="#FFF7ED"
              onPress={() => navigation.navigate("Payments")}
              testID={DATA_TRUTH_TEST_IDS.homePaymentsValue}
            />
          )}
        </View>

        {/* Activité récente */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Activité récente</Text>
          <Text style={styles.sectionLink}>Voir tout</Text>
        </View>

        <View style={styles.activityCard}>
          {canReadPayments && (
            <ActivityItem
              icon="cash-outline"
              title="Paiement reçu"
              description={`${paymentsData.filter((payment) => payment.status === "PAYE").length} paiement(s) validé(s)`}
              color="#16A34A"
              onPress={() => navigation.navigate("Payments")}
            />
          )}

          {canReadUsers && (
            <ActivityItem
              icon="person-add-outline"
              title="Comptes utilisateurs"
              description={`${usersValue} compte(s) actif(s)`}
              color="#2563EB"
              onPress={openUsers}
            />
          )}

          {!isSchoolAdmin && canReadStudents && (
            <ActivityItem
              icon="person-add-outline"
              title="Élèves inscrits"
              description={`${studentsValue} dossier(s) actif(s)`}
              color="#2563EB"
              onPress={() => navigation.navigate("Students")}
            />
          )}

          {canReadAnnouncements && (
            <ActivityItem
              icon="megaphone-outline"
              title="Annonce publiée"
              description={`${announcementsValue} communication(s) envoyée(s)`}
              color="#7C3AED"
              onPress={() => navigation.navigate("Announcements")}
            />
          )}
          {canReadMessages && (
            <ActivityItem
              icon="chatbubbles-outline"
              title="Messages parents"
              description={`${unreadMessagesValue} non lu(s) • ${messagesValue} échange(s)`}
              color="#0F766E"
              onPress={() => navigation.navigate("Messages")}
            />
          )}
        </View>

        {/* Actions rapides */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Actions rapides</Text>
        </View>

        <View style={styles.actionsGrid}>
          {canReadEntity(session, "users") && (
            <QuickAction
              icon="person-circle-outline"
              label="Utilisateurs"
              onPress={openUsers}
            />
          )}
          {!isSchoolAdmin && canReadEntity(session, "students") && (
            <QuickAction
              icon="add-circle-outline"
              label="Élèves"
              onPress={() => navigation.navigate("Students")}
            />
          )}
          {canReadEntity(session, "teachers") && (
            <QuickAction
              icon="person-add-outline"
              label="Profs"
              onPress={() => navigation.navigate("Teachers")}
            />
          )}
          {canReadEntity(session, "payments") && (
            <QuickAction
              icon="card-outline"
              label="Paiements"
              onPress={() => navigation.navigate("Payments")}
            />
          )}
          {canReadEntity(session, "paymentStatuses") && (
            <QuickAction
              icon="settings-outline"
              label="Statuts"
              onPress={() => navigation.navigate("AdminCrud", { entity: "paymentStatuses" })}
            />
          )}
          {canReadEntity(session, "announcements") && (
            <QuickAction
              icon="megaphone-outline"
              label="Annonces"
              onPress={() => navigation.navigate("Announcements")}
            />
          )}
          {canReadEntity(session, "messages") && (
            <QuickAction
              icon="chatbubbles-outline"
              label={unreadMessages > 0 ? `Messages (${unreadMessages})` : "Messages"}
              onPress={() => navigation.navigate("Messages")}
            />
          )}
          {canReadEntity(session, "classes") && (
            <QuickAction
              icon="grid-outline"
              label="Classes"
              onPress={() => navigation.navigate("Classes")}
            />
          )}
          {canReadEntity(session, "courses") && (
            <QuickAction
              icon="book-outline"
              label="Cours"
              onPress={() => navigation.navigate("AdminCrud", { entity: "courses" })}
            />
          )}
          {canReadEntity(session, "assignments") && (
            <QuickAction
              icon="swap-horizontal-outline"
              label="Affectations"
              onPress={() => navigation.navigate("AdminCrud", { entity: "assignments" })}
            />
          )}
          {canReadRoute(session, "Timetable") && (
            <QuickAction
              icon="time-outline"
              label="Planning"
              onPress={() => navigation.navigate("Timetable")}
            />
          )}
          {canReadRoute(session, "ReportCards") && (
            <QuickAction
              icon="document-text-outline"
              label="Bulletins"
              onPress={() => navigation.navigate("ReportCards")}
            />
          )}
          <OverflowQuickActionsGrid session={session} navigation={navigation} unreadMessages={unreadMessages} />
        </View>
      </ScrollView>
    </View>
  );
}

function buildTimeGreeting(timezone?: string) {
  const hour = getHourForTimezone(timezone);

  if (hour >= 18 || hour < 5) return "Bonsoir";
  if (hour >= 12) return "Bon après-midi";
  return "Bonjour";
}

function getHourForTimezone(timezone?: string) {
  try {
    const formattedHour = new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      hour12: false,
      timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).format(new Date());
    return Number(formattedHour.replace(/\D/g, ""));
  } catch {
    return new Date().getHours();
  }
}

function isActiveUserAccount(user: any) {
  const status = normalizeStatus(user?.status);
  return !["suspendu", "desactive", "désactivé", "disabled", "inactive", "inactif"].includes(status);
}

function normalizeStatus(value?: string) {
  return String(value ?? "Actif")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isTodayPresence(dateValue?: string) {
  return toDateKey(dateValue) === toDateKey(new Date());
}

function countAttendanceCalls(presenceRows: any[], students: any[]) {
  const studentClassById = new Map(students.map((student) => [student.id, student.className]));
  const callKeys = new Set(
    presenceRows.map((presence) => {
      const className = presence.className ?? studentClassById.get(presence.studentId) ?? "Classe inconnue";
      return `${toDateKey(presence.date)}-${className}`;
    })
  );
  return callKeys.size;
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

function getGreetingName(userName: string, role?: string) {
  if (!userName || /somafrik/i.test(userName)) {
    return role === "school_admin" ? "Administrateur" : "";
  }

  return userName;
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
    session?.role === "prefet" ||
    session?.role === "secretary"
  ) {
    return messagesData.filter(
      (message) => message.status === "Nouveau" && message.direction === "Parent vers école"
    ).length;
  }

  if (session?.role === "teacher") {
    const teacherStudents = scopedStudentsForSession(session, studentsData, teacherScopeState);
    const teacherParents = teacherStudents.map((student) => student.parentPhone);

    return messagesData.filter(
      (message) =>
        message.status === "Nouveau" &&
        (message.teacherId === session.user.id || teacherParents.includes(message.parentPhone)) &&
        message.direction === "Parent vers enseignant"
    ).length;
  }

  const parentPhone = session?.user.parentPhone ?? session?.user.children?.[0]?.parentPhone;

  return messagesData.filter(
    (message) =>
      message.status === "Nouveau" &&
      message.parentPhone === parentPhone &&
      (message.direction === "École vers parent" || message.direction === "Enseignant vers parent")
  ).length;
}

type StatCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  meta?: string;
  color: string;
  bg: string;
  onPress?: () => void;
  testID?: string;
};

function StatCard({ icon, value, label, meta, color, bg, onPress, testID }: StatCardProps) {
  return (
    <TouchableOpacity activeOpacity={0.85} style={styles.statCard} onPress={onPress} testID={testID}>
      <View style={[styles.statIconBox, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>

      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {meta ? <Text style={styles.statMeta}>{meta}</Text> : null}
    </TouchableOpacity>
  );
}

type ActivityItemProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  color: string;
  onPress?: () => void;
};

function ActivityItem({ icon, title, description, color, onPress }: ActivityItemProps) {
  return (
    <TouchableOpacity activeOpacity={0.85} style={styles.activityItem} onPress={onPress}>
      <View style={[styles.activityIcon, { backgroundColor: `${color}15` }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>

      <View style={styles.activityTextBox}>
        <Text style={styles.activityTitle}>{title}</Text>
        <Text style={styles.activityDescription}>{description}</Text>
      </View>

      <Ionicons name="chevron-forward-outline" size={18} color="#CBD5E1" />
    </TouchableOpacity>
  );
}

type QuickActionProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

type OverflowQuickActionsGridProps = {
  session: any;
  navigation: any;
  unreadMessages?: number;
  excludeTabNames?: string[];
};

function OverflowQuickActionsGrid({
  session,
  navigation,
  unreadMessages = 0,
  excludeTabNames = [],
}: OverflowQuickActionsGridProps) {
  const items = buildOverflowQuickActionItems(session).filter(
    (item) => !excludeTabNames.includes(item.tabName),
  );

  return items.map((item) => (
    <QuickAction
      key={item.tabName}
      icon={item.icon}
      label={item.label}
      onPress={() => navigation.navigate(item.tabName)}
    />
  ));
}

function QuickAction({ icon, label, onPress }: QuickActionProps) {
  return (
    <TouchableOpacity activeOpacity={0.85} style={styles.quickAction} onPress={onPress}>
      <View style={styles.quickActionIcon}>
        <Ionicons name={icon} size={22} color="#2563EB" />
      </View>

      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  scrollContent: {
    paddingTop: 48,
    paddingHorizontal: 20,
  },

  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
  },

  brand: {
    fontSize: 30,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.8,
  },

  subtitle: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2563EB",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  avatarText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },

  schoolCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  schoolIconBox: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
    padding: 4,
  },
  schoolLogoImage: {
    width: "100%",
    height: "100%",
    borderRadius: 16,
    resizeMode: "contain",
  },

  schoolInfo: {
    flex: 1,
  },

  schoolName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0F172A",
  },

  schoolCity: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
  },

  schoolTagline: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: "800",
    color: "#14B8A6",
  },

  welcomeCard: {
    backgroundColor: "#1D4ED8",
    borderRadius: 30,
    padding: 22,
    minHeight: 128,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 26,
    shadowColor: "#1D4ED8",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  parentWelcomeCard: {
    backgroundColor: "#0F766E",
    borderRadius: 30,
    padding: 22,
    minHeight: 128,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 26,
    shadowColor: "#0F766E",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  teacherWelcomeCard: {
    backgroundColor: "#4338CA",
    borderRadius: 30,
    padding: 22,
    minHeight: 128,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 26,
    shadowColor: "#4338CA",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  welcomeTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.5,
  },

  welcomeText: {
    marginTop: 10,
    color: "#DBEAFE",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 23,
    maxWidth: 230,
  },

  welcomeIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -0.3,
  },

  sectionLink: {
    fontSize: 13,
    fontWeight: "800",
    color: "#2563EB",
  },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 26,
  },
  statsGridTablet: {
    gap: 16,
  },

  statCard: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 18,
    marginBottom: 14,
    minHeight: 150,
    shadowColor: "#0F172A",
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  statIconBox: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },

  statValue: {
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -0.7,
  },

  statLabel: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "800",
    color: "#64748B",
  },

  statMeta: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "800",
    color: "#94A3B8",
  },

  activityCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 8,
    marginBottom: 26,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 20,
  },

  activityIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  activityTextBox: {
    flex: 1,
  },

  activityTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0F172A",
  },

  activityDescription: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },

  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  quickAction: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  quickActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  quickActionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
    color: "#0F172A",
  },
});
