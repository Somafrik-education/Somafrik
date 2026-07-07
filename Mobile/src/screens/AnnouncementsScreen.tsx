import { useEffect } from "react";
import { Alert, View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { canMutateEntity, canReadEntity } from "../domain/security/permissions";
import { markAnnouncementsRead } from "../lib/announcementsRead";
import { useFloatingTabBarLayout } from "../lib/screenLayout";

export default function AnnouncementsScreen({ navigation }: any) {
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const contentStyle = [styles.content, { paddingBottom: scrollContentPaddingBottom }];
  const { session } = useAuth();
  const { announcementsData, deleteItem } = useAdminData();
  const canRead = canReadEntity(session, "announcements");
  const canCreate = canMutateEntity(session, "announcements", "CREATE");
  const canUpdate = canMutateEntity(session, "announcements", "UPDATE");
  const canDelete = canMutateEntity(session, "announcements", "DELETE");

  useEffect(() => {
    if (canRead) {
      markAnnouncementsRead(session?.user?.id, announcementsData);
    }
  }, [canRead, session?.user?.id, announcementsData]);

  const confirmDelete = (announcement: any) => {
    if (!canDelete) {
      Alert.alert("Accès refusé", "Votre rôle ne permet pas de supprimer une annonce.");
      return;
    }

    Alert.alert("Supprimer l'annonce", "Confirmer la suppression ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: () => deleteItem("announcements", announcement.id),
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={contentStyle}>
      <Text style={styles.title}>Annonces</Text>
      <Text style={styles.subtitle}>Communications envoyées aux familles</Text>

      {!canRead && (
        <View style={styles.emptyState}>
          <Ionicons name="lock-closed-outline" size={24} color="#DC2626" />
          <Text style={styles.emptyText}>Accès refusé aux annonces.</Text>
        </View>
      )}

      {canRead && (
        <>
      {canCreate && (
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.addButton}
          onPress={() => navigation.navigate("AdminCrud", { entity: "announcements" })}
        >
          <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Nouvelle annonce</Text>
        </TouchableOpacity>
      )}

      {announcementsData.map((announcement) => (
        <View key={announcement.id} style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.cardMain}
            onPress={() => canUpdate && navigation.navigate("AdminCrud", { entity: "announcements" })}
          >
          <View style={styles.iconBox}>
            <Ionicons name="megaphone-outline" size={24} color="#7C3AED" />
          </View>
          <View style={styles.cardContent}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>{announcement.title}</Text>
              {(announcement.systemBroadcast === true ||
                String(announcement.scope ?? "").toLowerCase() === "system") && (
                <View style={styles.systemBadge}>
                  <Ionicons name="globe-outline" size={12} color="#1D4ED8" />
                  <Text style={styles.systemBadgeText}>Diffusion système</Text>
                </View>
              )}
            </View>
            <Text style={styles.message}>{announcement.message}</Text>
            <Text style={styles.date}>{announcement.date}</Text>
          </View>
          </TouchableOpacity>

          <View style={styles.actionRow}>
            {canUpdate && (
              <TouchableOpacity style={styles.smallAction} onPress={() => navigation.navigate("AdminCrud", { entity: "announcements" })}>
                <Ionicons name="create-outline" size={18} color="#2563EB" />
                <Text style={styles.smallActionText}>Modifier</Text>
              </TouchableOpacity>
            )}
            {canDelete && (
              <TouchableOpacity style={styles.smallDangerAction} onPress={() => confirmDelete(announcement)}>
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
                <Text style={styles.smallDangerText}>Supprimer</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      {announcementsData.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="megaphone-outline" size={24} color="#94A3B8" />
          <Text style={styles.emptyText}>Aucune annonce.</Text>
        </View>
      )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: "#0F172A",
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 20,
    color: "#64748B",
    fontWeight: "700",
  },
  addButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    color: "#FFFFFF",
    fontWeight: "900",
    marginLeft: 8,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
  },
  cardMain: {
    flexDirection: "row",
  },
  iconBox: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: "#F5F3FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  systemBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  systemBadgeText: {
    color: "#1D4ED8",
    fontWeight: "800",
    fontSize: 11,
  },
  message: {
    marginTop: 6,
    color: "#475569",
    fontWeight: "600",
    lineHeight: 20,
  },
  date: {
    marginTop: 8,
    color: "#7C3AED",
    fontWeight: "800",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  smallAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallActionText: { color: "#2563EB", fontWeight: "900" },
  smallDangerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "#FEF2F2",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallDangerText: { color: "#DC2626", fontWeight: "900" },
  emptyState: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
  },
  emptyText: {
    color: "#64748B",
    fontWeight: "800",
    marginTop: 8,
  },
});
