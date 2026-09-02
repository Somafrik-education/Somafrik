import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = { message: string };

/** État contrôlé si l'API de release est absente ou invalide — pas de fallback silencieux. */
export default function ConfigurationErrorScreen({ message }: Props) {
  return (
    <SafeAreaView style={styles.safe} testID="configuration-error">
      <View style={styles.card}>
        <Text style={styles.title}>Configuration invalide</Text>
        <Text style={styles.body}>{message}</Text>
        <Text style={styles.hint}>
          Ce build ne peut pas démarrer sans une URL API HTTPS correspondant à son profil.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0F172A",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
  },
  body: {
    fontSize: 15,
    color: "#334155",
    lineHeight: 22,
  },
  hint: {
    fontSize: 13,
    color: "#64748B",
    lineHeight: 18,
  },
});
