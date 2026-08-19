import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { DATA_TRUTH_COPY, DATA_TRUTH_TEST_IDS, type ResourceSnapshot } from "../lib/dataTruth";

type Props = {
  snapshot: ResourceSnapshot<unknown>;
  emptyMessage: string;
  errorMessage: string;
  offlineMessage: string;
  emptyTestId: string;
  errorTestId: string;
  onRetry: () => void;
  loadingLabel?: string;
};

export default function QueryStateView({
  snapshot,
  emptyMessage,
  errorMessage,
  offlineMessage,
  emptyTestId,
  errorTestId,
  onRetry,
  loadingLabel = "Chargement…",
}: Props) {
  if (snapshot.status === "idle" || snapshot.status === "loading") {
    return (
      <View style={styles.box} accessibilityRole="progressbar" accessibilityLabel={loadingLabel}>
        <ActivityIndicator color="#2563EB" />
        <Text style={styles.muted}>{loadingLabel}</Text>
      </View>
    );
  }

  if (snapshot.status === "offline" || snapshot.status === "error") {
    return (
      <View style={styles.box} testID={errorTestId} accessibilityRole="alert">
        <Text style={styles.errorText}>
          {snapshot.status === "offline" ? offlineMessage : snapshot.errorMessage || errorMessage}
        </Text>
        <TouchableOpacity
          style={styles.retry}
          onPress={onRetry}
          testID={DATA_TRUTH_TEST_IDS.retry}
          accessibilityRole="button"
          accessibilityLabel={DATA_TRUTH_COPY.retry}
        >
          <Text style={styles.retryText}>{DATA_TRUTH_COPY.retry}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (snapshot.status === "empty") {
    return (
      <View style={styles.box} testID={emptyTestId}>
        <Text style={styles.muted}>{emptyMessage}</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  muted: { color: "#64748B", fontWeight: "700", fontSize: 14 },
  errorText: { color: "#991B1B", fontWeight: "800", fontSize: 14, lineHeight: 20 },
  retry: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  retryText: { color: "#FFFFFF", fontWeight: "800" },
});
