import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import UserMutationControls from "../components/UserMutationControls";
import { useAdminData } from "../context/AdminDataContext";
import { displayRoleName, displayStatusName } from "../lib/format";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

export default function UsersScreen() {
  const bottomPadding = useStackScreenBottomPadding();
  const { usersSnapshot: snapshot, loadUsers: load, resourceScopeKey } = useAdminData();

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, resourceScopeKey]),
  );

  const listHydrated = snapshot.status === "success" && snapshot.data.length > 0;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
      testID={listHydrated ? "users-list" : undefined}
      data={snapshot.status === "success" ? snapshot.data : []}
      keyExtractor={(user) => user.id}
      refreshControl={<RefreshControl refreshing={snapshot.status === "loading"} onRefresh={() => void load()} />}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Utilisateurs</Text>
          <Text style={styles.subtitle}>Identités et rôles actifs chargés depuis PostgreSQL</Text>
          <UserMutationControls onChanged={() => load()} />
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
          ) : null}
        </>
      }
      renderItem={({ item: user }) => {
        const roles = user.activeRoles?.length
          ? user.activeRoles
          : [user.role, ...(user.secondaryRoles ?? [])].filter(Boolean);
        return (
          <View style={styles.card}>
            <View style={styles.iconBox}>
              <Ionicons name="person-outline" size={22} color="#2563EB" />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.name} numberOfLines={3}>
                {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.identifier}
              </Text>
              <Text style={styles.identifier}>{user.identifier || user.publicId}</Text>
              <Text style={styles.meta}>Rôles actifs : {roles.map((role) => displayRoleName(String(role))).join(", ") || "Aucun rôle actif"}</Text>
              <Text style={styles.meta}>Statut : {displayStatusName(user.status)}</Text>
              {user.schoolCode ? (
                <Text style={styles.meta} testID={`user-school-${user.schoolCode}`}>
                  Établissement : {user.schoolCode}
                </Text>
              ) : null}
              {user.email ? <Text style={styles.meta} numberOfLines={2}>{user.email}</Text> : null}
              {user.phone ? <Text style={styles.meta}>{user.phone}</Text> : null}
              <UserMutationControls row={user} onChanged={() => load()} />
            </View>
          </View>
        );
      }}
      ListFooterComponent={
        <Text style={styles.hint}>
          L'attribution du rôle Enseignant à un compte est autorisée. La modification de la matrice des droits reste disponible uniquement sur le Web.
        </Text>
      }
    />
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
  cardBody: { flex: 1, minWidth: 0 },
  name: { color: "#0F172A", fontSize: 16, fontWeight: "900" },
  identifier: { color: "#2563EB", fontWeight: "800", marginTop: 3 },
  meta: { color: "#64748B", fontWeight: "700", marginTop: 4 },
  hint: { color: "#64748B", fontWeight: "700", lineHeight: 20, marginTop: 8 },
});
