import { Text, StyleSheet, ScrollView, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import MenuCard from "../components/MenuCard";
import { AdminEntity, useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { canReadEntity, canReadRoute } from "../domain/security/permissions";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

type Props = NativeStackScreenProps<
  RootStackParamList,
  "SchoolManagement"
>;

export default function SchoolManagementScreen({
  navigation,
}: Props) {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const containerStyle = [styles.container, { paddingBottom: stackPaddingBottom }];
  const { session } = useAuth();
  const { syncStatus } = useAdminData();
  const isSchoolAdmin = session?.role === "school_admin";
  const items: { title: string; entity?: AdminEntity; route?: string }[] = [
    { title: "🏫 Établissements", entity: "schools" },
    { title: "👤 Utilisateurs", entity: "users" },
    ...(isSchoolAdmin ? [] : [{ title: "👥 Élèves", entity: "students" as const }]),
    { title: "👨‍🏫 Enseignants", entity: "teachers" },
    { title: "📚 Classes", entity: "classes" },
    { title: "📖 Cours", entity: "courses" },
    { title: "🔁 Affectations", entity: "assignments" },
    { title: "💰 Paiements", entity: "payments" },
    { title: "⚙️ Statuts paiement", entity: "paymentStatuses" },
    { title: "📢 Annonces", entity: "announcements" },
  ];
  const visibleItems = items.filter((item) =>
    item.entity ? canReadEntity(session, item.entity) : canReadRoute(session, item.route)
  );

  return (
    <ScrollView contentContainerStyle={containerStyle}>
      <Text style={styles.title}>Gestion de l'école</Text>

      {syncStatus === "offline" && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Hors connexion — les dernières données synchronisées sont affichées et peuvent ne pas
            être à jour.
          </Text>
        </View>
      )}

      {visibleItems.map((item) => (
        <MenuCard
          key={item.entity ?? item.route}
          title={item.title}
          onPress={() =>
            item.entity
              ? navigation.navigate("AdminCrud", { entity: item.entity })
              : navigation.navigate(item.route as never)
          }
        />
      ))}

      {visibleItems.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucun module autorisé pour ce rôle.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 30,
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
  },
  emptyText: {
    color: "#64748B",
    fontWeight: "700",
  },
  offlineBanner: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FCD34D",
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  offlineText: {
    color: "#92400E",
    fontWeight: "700",
    fontSize: 13,
  },
});
