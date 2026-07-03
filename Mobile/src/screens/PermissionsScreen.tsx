import React, { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import SchoolSelector from "../components/SchoolSelector";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import { getSuperadminMatrixModules } from "../lib/roleGovernance";
import { CRUD_ACTIONS } from "../lib/constants";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

const TARGET_ROLES = [COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE] as const;

export default function PermissionsScreen() {
  const { session } = useAuth();
  const { rolePermissionsData, updateRoleFeatureAccess } = useAdminData();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [targetRole, setTargetRole] = useState<(typeof TARGET_ROLES)[number]>(SCHOOL_ADMIN_ROLE);
  const [selectedModule, setSelectedModule] = useState("Utilisateurs");

  const modules = useMemo(() => getSuperadminMatrixModules(targetRole), [targetRole]);
  const rolePermissions = rolePermissionsData[targetRole] ?? [];

  if (session?.role !== "super_admin") {
    return (
      <View style={styles.denied}>
        <Text style={styles.deniedText}>Matrice Super Admin reservee au Super Administrateur.</Text>
      </View>
    );
  }

  const togglePermission = (module: string, action: string, enabled: boolean) => {
    updateRoleFeatureAccess(targetRole, module, [`${module}:${action}`], enabled);
  };

  const hasPermission = (module: string, action: string) =>
    rolePermissions.includes(`${module}:${action}`) || rolePermissions.includes(`${module}:CRUD`);

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
    >
      <SchoolSelector />
      <Text style={styles.title}>Droits par role</Text>
      <Text style={styles.subtitle}>Matrice plateforme alignee web v13 (Admin Pays / Admin School).</Text>

      <View style={styles.roleRow}>
        {TARGET_ROLES.map((role) => (
          <TouchableOpacity
            key={role}
            style={[styles.roleChip, targetRole === role && styles.roleChipActive]}
            onPress={() => {
              setTargetRole(role);
              setSelectedModule(getSuperadminMatrixModules(role)[0] ?? "Utilisateurs");
            }}
          >
            <Text style={[styles.roleChipText, targetRole === role && styles.roleChipTextActive]}>{role}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moduleRow}>
        {modules.map((module) => (
          <TouchableOpacity
            key={module}
            style={[styles.moduleChip, selectedModule === module && styles.moduleChipActive]}
            onPress={() => setSelectedModule(module)}
          >
            <Text style={styles.moduleChipText}>{module}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={[styles.matrix, isTablet && styles.matrixTablet]}>
        {CRUD_ACTIONS.filter((action) => action.key !== "SUSPEND" || selectedModule === "Utilisateurs").map(
          (action) => {
            const enabled = hasPermission(selectedModule, action.key);
            return (
              <TouchableOpacity
                key={action.key}
                style={[styles.matrixRow, enabled && styles.matrixRowActive]}
                onPress={() => togglePermission(selectedModule, action.key, !enabled)}
              >
                <Text style={styles.matrixLabel}>{action.label}</Text>
                <Text style={styles.matrixValue}>{enabled ? "Active" : "Desactive"}</Text>
              </TouchableOpacity>
            );
          },
        )}
      </View>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => Alert.alert("Synchronise", "Les droits sont enregistrés dans la plateforme partagée.")}
      >
        <Text style={styles.secondaryBtnText}>Les changements sont synchronises automatiquement</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16 },
  roleRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  roleChip: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  roleChipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  roleChipText: { textAlign: "center", fontWeight: "700", color: "#334155" },
  roleChipTextActive: { color: "#FFFFFF" },
  moduleRow: { gap: 8, marginBottom: 16 },
  moduleChip: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  moduleChipActive: { backgroundColor: "#DBEAFE", borderColor: "#93C5FD" },
  moduleChipText: { fontWeight: "700", color: "#334155", fontSize: 13 },
  matrix: { gap: 10 },
  matrixTablet: { flexDirection: "row", flexWrap: "wrap" },
  matrixRow: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    minWidth: 280,
    flex: 1,
  },
  matrixRowActive: { borderLeftWidth: 4, borderLeftColor: "#2563EB" },
  matrixLabel: { fontWeight: "700", color: "#111827" },
  matrixValue: { fontWeight: "800", color: "#2563EB" },
  secondaryBtn: { marginTop: 16, padding: 12 },
  secondaryBtnText: { textAlign: "center", color: "#64748B", fontWeight: "600" },
  denied: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  deniedText: { color: "#64748B", fontWeight: "700", textAlign: "center" },
});
