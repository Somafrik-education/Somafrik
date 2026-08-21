import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import AdminCrudScreen from "./AdminCrudScreen";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  canRunGenericAdminCrud,
  canonicalRouteForAdminEntity,
} from "../lib/mobileMutationSafety";

type Props = NativeStackScreenProps<RootStackParamList, "AdminCrud">;

export default function SafeAdminCrudScreen(props: Props) {
  const { entity } = props.route.params;

  if (canRunGenericAdminCrud(entity)) {
    return <AdminCrudScreen {...props} />;
  }

  const canonicalRoute = canonicalRouteForAdminEntity(entity);

  return (
    <View style={styles.screen} testID="admin-crud-fail-closed">
      <View style={styles.iconBox}>
        <Ionicons name="shield-checkmark-outline" size={28} color="#2563EB" />
      </View>
      <Text style={styles.title}>Mutation mobile sécurisée</Text>
      <Text style={styles.body}>
        Cette mutation générique a été retirée du Mobile car elle ne garantissait pas une écriture
        canonique PostgreSQL. Aucune modification locale n&apos;est appliquée.
      </Text>
      {canonicalRoute ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => props.navigation.navigate(canonicalRoute as never)}
        >
          <Text style={styles.primaryButtonText}>Ouvrir l&apos;écran canonique</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.hint}>
          Cette action reste disponible sur le Web canonique jusqu&apos;au branchement de son API Mobile.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  iconBox: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  body: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 10,
    maxWidth: 440,
  },
  primaryButton: {
    marginTop: 22,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  hint: {
    color: "#64748B",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 18,
    maxWidth: 440,
  },
});
