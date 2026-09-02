import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import { listAssignableEstablishmentRoles, type AssignableEstablishmentRole } from "../services/schoolSettingsApi";

export default function SchoolAssignableRolesScreen() {
  const { canOpen } = useSchoolSettingsAccess("SchoolAssignableRoles");
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [roles, setRoles] = useState<AssignableEstablishmentRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await listAssignableEstablishmentRoles();
      setRoles(payload.roles ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les rôles disponibles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    >
      <Text style={styles.title}>Rôles disponibles</Text>
      <Text style={styles.subtitle}>
        Catalogue géré par le Super administrateur. Lecture seule : vous pouvez affecter ces rôles aux utilisateurs, sans modifier la politique.
      </Text>
      {loading ? <Text style={styles.meta}>Chargement…</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {!loading && !roles.length ? <Text style={styles.meta}>Aucun rôle affectable pour cet établissement.</Text> : null}
      {roles.map((role) => (
        <View key={role.id} style={styles.card}>
          <Text style={styles.cardTitle}>{role.roleName}</Text>
          <Text style={styles.meta}>{role.roleCode}</Text>
          <View style={styles.wrap}>
            {(role.permissions ?? []).length ? (
              role.permissions.map((permission) => (
                <Text key={permission} style={styles.badge}>
                  {permission}
                </Text>
              ))
            ) : (
              <Text style={styles.meta}>Aucune permission définie pour ce rôle.</Text>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 26, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  meta: { color: "#64748B", fontWeight: "600", marginTop: 4 },
  error: { color: "#991B1B", fontWeight: "800", marginBottom: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  badge: {
    backgroundColor: "#EFF6FF",
    color: "#1D4ED8",
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
});
