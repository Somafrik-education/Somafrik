import React from "react";
import { Alert, ScrollView, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import StudentSwitcher from "../components/StudentSwitcher";
import SchoolSelector from "../components/SchoolSelector";
import { AdminEntity, useAdminData } from "../context/AdminDataContext";
import { canReadEntity, canReadRoute, canReadView } from "../domain/security/permissions";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { ENTITY_VIEW_MAP } from "../lib/constants";
import { scopedStudentsForSession, teacherScopedClassLabels } from "../lib/establishment";

type MenuItem = {
  label: string;
  entity?: AdminEntity;
  route?: string;
  view?: string;
  message?: string;
};

const adminMenuItems: MenuItem[] = [
  { label: "🌍 Pays", entity: "countries", view: "countries" },
  { label: "🏫 Établissements", entity: "schools", view: "schools" },
  { label: "📦 Abonnements", entity: "subscriptions", view: "subscriptions" },
  { label: "🔔 Notifications plateforme", route: "PlatformNotifications", view: "PlatformNotifications" },
  { label: "🔐 Droits par rôle", route: "Permissions", view: "Permissions" },
  { label: "⚙️ Configuration", route: "Configuration", view: "Configuration" },
  { label: "👤 Utilisateurs", entity: "users", view: "users" },
  { label: "👥 Élèves", entity: "students", view: "students" },
  { label: "👨‍🏫 Enseignants", entity: "teachers", view: "teachers" },
  { label: "📚 Classes", entity: "classes", view: "classes" },
  { label: "📖 Cours", entity: "courses", view: "courses" },
  { label: "🔁 Affectations", entity: "assignments", view: "assignments" },
  { label: "💰 Paiements", entity: "payments", view: "payments" },
  { label: "⚙️ Statuts paiement", entity: "paymentStatuses", view: "configuration" },
  { label: "📢 Annonces", entity: "announcements", view: "announcements" },
  { label: "🗓️ Emplois du temps", route: "Timetable", view: "Timetable" },
  { label: "📄 Bulletins", route: "ReportCards", view: "ReportCards" },
  { label: "📄 Documents scolaires", route: "Documents", view: "Documents" },
  { label: "📊 Rapports", route: "Reports", view: "Reports" },
  { label: "🔐 Audit et connexions", route: "Audit", view: "Audit" },
  { label: "🆘 Support", route: "Support", view: "Support" },
];

const parentMenuItems: MenuItem[] = [
  { label: "👨‍👩‍👧 Compte parent", route: "Profil", view: "Profil" },
  { label: "📚 Suivi scolaire", route: "Notes", view: "Notes" },
  { label: "📄 Bulletins PDF", route: "ReportCards", view: "ReportCards" },
  { label: "💰 Situation des frais", route: "FraisEleve", view: "FraisEleve" },
  { label: "📱 Paiement mobile", route: "MobilePayment", view: "MobilePayment" },
  { label: "📢 Annonces de l'école", route: "Announcements", view: "Announcements" },
  { label: "🔄 Mode hors ligne", route: "OfflineMode", view: "OfflineMode" },
  { label: "🆘 Support", route: "Support", view: "Support" },
];

const studentMenuItems: MenuItem[] = [
  { label: "👤 Mon profil", route: "Profil", view: "Profil" },
  { label: "📚 Mes notes", route: "Notes", view: "Notes" },
  { label: "📄 Mes bulletins", route: "ReportCards", view: "ReportCards" },
  { label: "✅ Mes présences", route: "Presences", view: "Presences" },
  { label: "🗓️ Mon emploi du temps", route: "Timetable", view: "Timetable" },
  { label: "💰 Mes paiements", route: "FraisEleve", view: "FraisEleve" },
  { label: "📢 Annonces", route: "Announcements", view: "Announcements" },
  { label: "🔄 Mode hors ligne", route: "OfflineMode", view: "OfflineMode" },
];

const teacherMenuItems: MenuItem[] = [
  { label: "👨‍🏫 Profil enseignant", route: "Support", view: "Support" },
  { label: "📚 Mes classes", route: "Classes", view: "Classes" },
  { label: "✅ Appel des présences", route: "TeacherAttendance", view: "TeacherAttendance" },
  { label: "📝 Gestion des notes", route: "TeacherGrades", view: "TeacherGrades" },
  { label: "📄 Bulletins", route: "ReportCards", view: "ReportCards" },
  { label: "🗓️ Mon emploi du temps", route: "Timetable", view: "Timetable" },
  { label: "📢 Annonces de l'école", route: "Announcements", view: "Announcements" },
  { label: "🔄 Synchronisation", route: "Synchronization", view: "Synchronization" },
  { label: "🆘 Support", route: "Support", view: "Support" },
];

function filterMenuItemsByPermission(session: any, items: MenuItem[]) {
  return items.filter((item) => {
    if (session?.role === "school_admin" && item.entity === "students") return false;
    const view = item.view ?? (item.entity ? ENTITY_VIEW_MAP[item.entity] : item.route);
    if (view && !canReadView(session, view)) return false;
    if (item.entity) return canReadEntity(session, item.entity);
    if (item.route) return canReadRoute(session, item.route);
    return true;
  });
}

export default function MenuScreen() {
  const navigation = useNavigation<any>();
  const { session, logout } = useAuth();
  const { studentsData, teachersData, assignmentsData, classesData } = useAdminData();
  const teacherScopeState = { teachers: teachersData, assignments: assignmentsData, classes: classesData };
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const { isTablet, horizontalPadding, contentMaxWidth, columns } = useResponsiveLayout();
  const isParentStudent = session?.role === "parent_student";
  const isStudent = session?.role === "student";
  const isTeacher = session?.role === "teacher";
  const isPlatformAdmin = session?.role === "super_admin" || session?.role === "country_admin";
  const menuItems = isStudent
    ? filterMenuItemsByPermission(session, studentMenuItems)
    : isParentStudent
    ? filterMenuItemsByPermission(session, parentMenuItems)
    : isTeacher
      ? filterMenuItemsByPermission(session, teacherMenuItems)
      : filterMenuItemsByPermission(session, adminMenuItems);

  const handleLogout = () => {
    logout();
    navigation.reset({
      index: 0,
      routes: [{ name: "Welcome" }],
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: scrollContentPaddingBottom, paddingHorizontal: horizontalPadding, maxWidth: contentMaxWidth, alignSelf: "center", width: "100%" },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Menu</Text>
      <Text style={styles.userName}>{session?.user.name ?? "Utilisateur"}</Text>

      {isPlatformAdmin && <SchoolSelector />}

      {isParentStudent && (
        <>
          <StudentSwitcher />
          <Text style={styles.childrenCount}>
            {session?.user.children?.length ?? 0} enfant(s) lié(s) à ce compte
          </Text>
        </>
      )}

      {isTeacher && (
        <Text style={styles.childrenCount}>
          {(session?.user.courses ?? []).join(", ")} •{" "}
          {teacherScopedClassLabels(
            session,
            scopedStudentsForSession(session, studentsData, teacherScopeState),
            teacherScopeState,
          ).join(", ") || "Classes non renseignées"}
        </Text>
      )}

      <View style={isTablet ? styles.gridTablet : undefined}>
        {menuItems.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.item, isTablet && { width: `${100 / columns - 2}%`, minWidth: 280 }]}
            onPress={() => {
              if (item.entity === "users" && session?.role === "school_admin") {
                navigation.navigate("Utilisateurs");
                return;
              }
              if (item.entity) {
                navigation.navigate("AdminCrud", { entity: item.entity });
                return;
              }

              if (item.route) {
                navigation.navigate(item.route as never);
                return;
              }

              Alert.alert("Information", item.message ?? "Action non configurée pour ce rôle.");
            }}
          >
            <View style={styles.itemLabelBox}>
              <Text style={styles.itemText}>{item.label}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.logout} onPress={handleLogout}>
        <Text style={styles.logoutText}>Déconnexion</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  scrollContent: { flexGrow: 1, paddingTop: 20 },
  title: { fontSize: 28, fontWeight: "800", marginBottom: 24, color: "#111827" },
  userName: {
    marginTop: -16,
    marginBottom: 18,
    color: "#64748B",
    fontWeight: "700",
  },
  childrenCount: {
    color: "#2563EB",
    fontWeight: "800",
    marginTop: -8,
    marginBottom: 14,
  },
  gridTablet: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  item: {
    backgroundColor: "#FFFFFF",
    padding: 18,
    borderRadius: 18,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemText: { fontSize: 16, fontWeight: "600", color: "#111827" },
  itemLabelBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  badge: {
    minWidth: 24,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#DC2626",
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    marginLeft: 8,
  },
  chevron: { fontSize: 28, color: "#9CA3AF" },
  logout: {
    backgroundColor: "#EF4444",
    padding: 18,
    borderRadius: 18,
    marginTop: 20,
  },
  logoutText: {
    color: "#FFFFFF",
    fontWeight: "800",
    textAlign: "center",
  },
});
