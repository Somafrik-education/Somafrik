import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import SchoolSelector from "../components/SchoolSelector";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import { getSuperadminMatrixModules } from "../lib/roleGovernance";
import { CRUD_ACTIONS } from "../lib/constants";
import { displayRoleName } from "../lib/format";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import { MOBILE_ROLE_PERMISSION_MUTATION_ENABLED } from "../lib/mobileMutationSafety";

const TARGET_ROLES = [COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE] as const;

export default function PermissionsScreen() {
  const { session } = useAuth();
  const { rolePermissionsData } = useAdminData();
  const { isTablet, horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [targetRole, setTargetRole] = useState<(typeof TARGET_ROLES)[number]>(SCHOOL_ADMIN_ROLE);
  const [selectedModule, setSelectedModule] = useState("Utilisateurs");

  const modules = useMemo(() => getSuperadminMatrixModules(targetRole), [targetRole]);
  const rolePermissions = rolePermissionsData[targetRole] ?? [];

  if (session?.role !== "super_admin") {
    return (
      <View style={styles.denied}>
        <Text style={styles.deniedText}>Matrice réservée au Super administrateur.</Text>
      </View>
    );
  }

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
      <Text style={styles.title}>Droits par rôle</Text>
      <Text style={styles.subtitle}>Lecture de la matrice plateforme issue du backend canonique.</Text>

      {!MOBILE_ROLE_PERMISSION_MUTATION_ENABLED ? (
        <View style={styles.readOnlyBanner} testID="permissions-read-only-banner">
          <Ionicons name="shield-checkmark-outline" size={20} color="#1D4ED8" />
          <View style={styles.readOnlyTextBlock}>
            <Text style={styles.readOnlyTitle}>Modification Mobile désactivée</Text>
            <Text style={styles.readOnlyText}>
              L’attribution et le retrait des droits ne sont plus simulés localement. Utilisez l’interface Web canonique jusqu’au
              branchement de la modification RBAC sur mobile avec contrôle du périmètre et de la concurrence.
            </Text>
          </View>
        </View>
      ) : null}

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
            <Text style={[styles.roleChipText, targetRole === role && styles.roleChipTextActive]}>{displayRoleName(role)}</Text>
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
              <View
                key={action.key}
                style={[styles.matrixRow, enabled && styles.matrixRowActive]}
                accessibilityLabel={`${action.label}: ${enabled ? "actif" : "inactif"}`}
              >
                <Text style={styles.matrixLabel}>{action.label}</Text>
                <Text style={styles.matrixValue}>{enabled ? "Actif" : "Inactif"}</Text>
              </View>
            );
          },
        )}
      </View>

      <Text style={styles.readOnlyFooter}>
        Lecture seule sur mobile — aucune modification locale n&apos;est considérée comme enregistrée.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16 },
  readOnlyBanner: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  readOnlyTextBlock: { flex: 1 },
  readOnlyTitle: { color: "#1E3A8A", fontWeight: "900", marginBottom: 4 },
  readOnlyText: { color: "#475569", fontWeight: "700", lineHeight: 19 },
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
  readOnlyFooter: {
    marginTop: 16,
    color: "#64748B",
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  denied: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  deniedText: { color: "#64748B", fontWeight: "700", textAlign: "center" },
});
