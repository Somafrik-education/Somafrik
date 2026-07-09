import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAdminData } from "../context/AdminDataContext";
import { OFFLINE_COPY, OFFLINE_TEST_IDS } from "../lib/offlineModeSpec";

export default function OfflineBanner() {
  const { syncStatus } = useAdminData();

  if (syncStatus === "syncing") {
    return null;
  }

  if (syncStatus === "offline") {
    return (
      <View style={styles.banner} testID={OFFLINE_TEST_IDS.banner} accessibilityRole="alert">
        <Ionicons name="cloud-offline-outline" size={18} color="#92400E" />
        <View style={styles.textWrap}>
          <Text style={styles.title} testID={OFFLINE_TEST_IDS.bannerTitle}>
            {OFFLINE_COPY.bannerTitle}
          </Text>
          <Text style={styles.hint} testID={OFFLINE_TEST_IDS.bannerHint}>
            {OFFLINE_COPY.bannerHint}
          </Text>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FEF3C7",
    borderBottomWidth: 1,
    borderBottomColor: "#FCD34D",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: "#92400E",
    fontWeight: "900",
    fontSize: 14,
  },
  hint: {
    color: "#B45309",
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 16,
  },
});
