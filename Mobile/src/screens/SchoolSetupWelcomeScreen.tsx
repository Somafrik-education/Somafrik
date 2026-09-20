import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

export default function SchoolSetupWelcomeScreen({ navigation }: any) {
  return (
    <View style={styles.screen} testID="school-setup-welcome">
      <Text style={styles.title}>Bienvenue sur Somafrik</Text>
      <Text style={styles.body}>
        Configurez votre établissement étape par étape. Vous pourrez quitter et reprendre plus tard.
      </Text>
      <TouchableOpacity
        style={styles.primary}
        onPress={() => navigation.navigate("SchoolSetup")}
        accessibilityRole="button"
        accessibilityLabel="Configurer mon établissement"
      >
        <Text style={styles.primaryText}>Configurer mon établissement</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondary}
        onPress={() => navigation.navigate("Home")}
        accessibilityRole="button"
        accessibilityLabel="Quitter et reprendre plus tard"
      >
        <Text style={styles.secondaryText}>Quitter et reprendre plus tard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F7FB", padding: 20, gap: 16, justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  body: { color: "#64748B", lineHeight: 22, fontWeight: "600" },
  primary: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryText: { color: "#FFFFFF", fontWeight: "800" },
  secondary: {
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: "#2563EB", fontWeight: "700" },
});
