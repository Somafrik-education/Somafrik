import { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import { useCanonicalResource } from "../hooks/useCanonicalResource";
import {
  getCanonicalUsers,
  type CanonicalUserAccount,
} from "../services/domainHydrationApi";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

export default function UsersScreen() {
  const bottomPadding = useStackScreenBottomPadding();
  const { snapshot, load } = useCanonicalResource<CanonicalUserAccount>(getCanonicalUsers);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
    >
      <Text style={styles.title}>Utilisateurs</Text>
      <Text style={styles.subtitle}>Identités et rôles actifs chargés depuis PostgreSQL</Text>

      {snapshot.status !== "success" ? (
        <QueryStateView
          snapshot={snapshot}
          emptyMessage="Aucun utilisateur."
          errorMessage="Impossible de charger les utilisateurs."
          offlineMessage="Réseau indisponible. Les utilisateurs n'ont pas pu être chargés."
          emptyTestId="users-empty"
          errorTestId="users-error"
          onRetry={() => void load()}
          loadingLabel="Chargement des utilisateurs…"
        />
      ) : (
        snapshot.data.map((user) => {
          const roles = user.activeRoles?.length
            ? user.activeRoles
            : [user.role, ...(user.secondaryRoles ?? [])].filter(Boolean);
          return (
            <View key={user.id} style={styles.card}>
              <View style={styles.iconBox}>
                <Ionicons name="person-outline" size={22} color="#2563EB" />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.name}>{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.identifier}</Text>
                <Text style={styles.identifier}>{user.identifier || user.publicId}</Text>
                <Text style={styles.meta}>Rôles actifs : {roles.join(", ") || "Aucun rôle actif"}</Text>
                <Text style={styles.meta}>Statut : {user.status || "Non renseigné"}</Text>
                {user.schoolCode ? <Text style={styles.meta}>Établissement : {user.schoolCode}</Text> : null}
              </View>
            </View>
          );
        })
      )}

      <Text style={styles.hint}>
        Ce lot expose la lecture canonique. Les GRANT/REVOKE restent soumis aux contrats serveur et ne sont pas simulés localement.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20 },
  title: { fontSize: 30, fontWeight: "900", color: "#0F172A" },
  subtitle: { color: "#64748B", fontWeight: "700", marginTop: 6, marginBottom: 18 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    gap: 12,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1 },
  name: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  identifier: { color: "#2563EB", fontWeight: "800", marginTop: 3 },
  meta: { color: "#64748B", fontWeight: "700", marginTop: 4 },
  hint: { color: "#64748B", fontWeight: "700", lineHeight: 20, marginTop: 8 },
});
