import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { resolveCanonicalRoleIdentity } from "../lib/canonicalRoleIdentity";
import { getAllowedRoleDrawerItems, type RoleDrawerItem } from "../navigation/roleDrawerPreferences";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Superadmin",
  country_admin: "Admin pays",
  school_admin: "Admin établissement",
  principal: "Directeur",
  proviseur: "Proviseur",
  prefet: "Préfet des études",
  secretary: "Secrétariat",
  accountant: "Comptable",
  adjoint: "Adjoint",
  supervisor: "Surveillant",
  teacher: "Enseignant",
  parent_student: "Parent",
  student: "Élève",
};

export default function RoleNavigationDrawer({
  visible,
  onClose,
  navigation,
}: {
  visible: boolean;
  onClose: () => void;
  navigation: any;
}) {
  const { session, logout } = useAuth();
  const items = getAllowedRoleDrawerItems(session);
  const schoolName = session?.school?.name ?? session?.user?.schoolCode ?? "Somafrik";
  const userName = session?.user?.name ?? "Utilisateur";
  const identity = resolveCanonicalRoleIdentity(session);
  const roleLabel = identity.roleLabel || ROLE_LABELS[session?.role ?? ""] || "Compte Somafrik";

  const rootNavigation = navigation.getParent?.() ?? navigation;

  const openItem = (item: RoleDrawerItem) => {
    onClose();
    if (item.entity) {
      rootNavigation.navigate("AdminCrud", { entity: item.entity });
      return;
    }
    if (item.route) {
      rootNavigation.navigate(item.route);
    }
  };

  const handleLogout = () => {
    onClose();
    logout();
    rootNavigation.reset({ index: 0, routes: [{ name: "Welcome" }] });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay} testID="mobile-role-drawer">
        <SafeAreaView style={styles.panel} edges={["top", "bottom"]}>
          <View style={styles.header}>
            <View style={styles.identity}>
              <Text style={styles.schoolName} numberOfLines={1}>{schoolName}</Text>
              <Text style={styles.userName} numberOfLines={1}>{userName}</Text>
              <Text style={styles.role}>{roleLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Fermer le menu"
              testID="mobile-role-drawer-close"
            >
              <Ionicons name="close" size={24} color="#0F172A" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <DrawerButton
              label="Accueil"
              icon="home-outline"
              onPress={() => {
                onClose();
                navigation.navigate("Accueil");
              }}
            />

            <Text style={styles.sectionTitle}>Navigation</Text>
            {items.map((item) => (
              <DrawerButton
                key={`${item.label}-${item.route ?? item.entity ?? "item"}`}
                label={item.label}
                icon={item.icon}
                onPress={() => openItem(item)}
              />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel="Déconnexion"
              testID="mobile-role-drawer-logout"
            >
              <Ionicons name="log-out-outline" size={21} color="#B91C1C" />
              <Text style={styles.logoutText}>Déconnexion</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer le menu" />
      </View>
    </Modal>
  );
}

function DrawerButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.item}
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.itemIcon}>
        <Ionicons name={icon} size={21} color="#334155" />
      </View>
      <Text style={styles.itemLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(15, 23, 42, 0.38)",
  },
  panel: {
    width: "86%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    overflow: "hidden",
  },
  backdrop: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  identity: { flex: 1, minWidth: 0 },
  schoolName: { color: "#0F172A", fontSize: 19, fontWeight: "900" },
  userName: { color: "#334155", fontSize: 14, fontWeight: "800", marginTop: 5 },
  role: { color: "#0F766E", fontSize: 12, fontWeight: "900", marginTop: 3 },
  closeButton: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    marginLeft: 8,
  },
  list: { paddingHorizontal: 12, paddingVertical: 14 },
  sectionTitle: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 7,
    marginHorizontal: 8,
  },
  item: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
    marginRight: 10,
  },
  itemLabel: { flex: 1, color: "#0F172A", fontSize: 15, fontWeight: "800" },
  footer: { borderTopWidth: 1, borderTopColor: "#E2E8F0", padding: 12 },
  logoutButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#FEF2F2",
  },
  logoutText: { color: "#B91C1C", fontSize: 15, fontWeight: "900" },
});
