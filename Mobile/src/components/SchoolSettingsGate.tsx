import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { canReadView, hasSecurityPermission } from "../domain/security/permissions";
import { isSchoolSettingsView, type SchoolSettingsView } from "../lib/schoolSettingsAccess";

export function useSchoolSettingsAccess(view: SchoolSettingsView) {
  const { session } = useAuth();
  const canOpen = isSchoolSettingsView(view) && canReadView(session, view);
  const canEdit = canOpen && hasSecurityPermission(session, "Paramètres Établissement", "UPDATE");
  return { session, canOpen, canEdit };
}

export function SchoolSettingsDenied({ message }: { message?: string }) {
  return (
    <View style={styles.denied} testID="school-settings-denied">
      <Text style={styles.deniedText}>
        {message ?? "Accès aux paramètres de l’établissement non autorisé pour ce rôle."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  denied: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F4F7FB" },
  deniedText: { color: "#64748B", fontWeight: "700", textAlign: "center" },
});
