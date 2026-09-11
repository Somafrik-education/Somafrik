import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import QueryStateView from "../components/QueryStateView";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import UserMutationControls from "../components/UserMutationControls";
import { useAdminData } from "../context/AdminDataContext";
import { nextExclusiveExpandedKey } from "../lib/expandableEntity";
import { displayRoleName, displayStatusName } from "../lib/format";
import { formatAccessRolesDisplay, formatBusinessProfileKind } from "../lib/businessProfile";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

export default function UsersScreen() {
  const bottomPadding = useStackScreenBottomPadding();
  const { usersSnapshot: snapshot, loadUsers: load, resourceScopeKey } = useAdminData();
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

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
      extraData={expandedUserId}
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
        const accessRoles = formatAccessRolesDisplay(user);
        const statusLabel = user.status ? displayStatusName(user.status) : "";
        const statusKey = String(user.status ?? "").toLowerCase();
        const badgeTone =
          /archiv|inactif|inactive|disabled|desactiv|suspend/.test(statusKey) ? "warning" as const : "default" as const;
        return (
          <ExpandableEntityCard
            title={[user.firstName, user.lastName].filter(Boolean).join(" ") || user.identifier}
            subtitle={String(user.identifier || user.publicId || "")}
            badge={statusLabel}
            badgeTone={badgeTone}
            expanded={expandedUserId === user.id}
            onExpandedChange={() =>
              setExpandedUserId((current) => nextExclusiveExpandedKey(current, user.id))
            }
          >
            <Text style={styles.meta} testID="user-business-kind">
              Type métier : {formatBusinessProfileKind(user)}
            </Text>
            <Text style={styles.meta} testID="user-access-roles">
              Rôle(s) d'accès : {accessRoles.split(" · ").map((role) => displayRoleName(role)).join(" · ")}
            </Text>
            {user.schoolCode ? (
              <Text style={styles.meta} testID={`user-school-${user.schoolCode}`}>
                Établissement : {user.schoolCode}
              </Text>
            ) : null}
            {user.email ? <Text style={styles.meta} numberOfLines={2}>{user.email}</Text> : null}
            {user.phone ? <Text style={styles.meta}>{user.phone}</Text> : null}
            <UserMutationControls row={user} onChanged={() => load()} />
          </ExpandableEntityCard>
        );
      }}
      ListFooterComponent={
        <Text style={styles.hint}>
          L'attribution du rôle Enseignant est refusée pour un compte lié à un élève actif. La modification de la matrice des droits reste disponible uniquement sur le Web.
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
  meta: { color: "#64748B", fontWeight: "700", marginTop: 4 },
  hint: { color: "#64748B", fontWeight: "700", lineHeight: 20, marginTop: 8 },
});
