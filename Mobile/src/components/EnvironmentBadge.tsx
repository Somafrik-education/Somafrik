import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getEnvironmentBadgeLabel, shouldShowEnvironmentBadge } from "../config/env";

/** Marqueur d'environnement visible, non intrusif — jamais en production. */
export default function EnvironmentBadge() {
  if (!shouldShowEnvironmentBadge()) return null;
  const label = getEnvironmentBadgeLabel();
  if (!label) return null;
  return <EnvironmentBadgeInner label={label} />;
}

function EnvironmentBadgeInner({ label }: { label: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: Math.max(insets.top, 8) }]}
      testID="environment-badge"
      accessibilityRole="text"
      accessibilityLabel={`Environnement ${label}`}
    >
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 12,
    zIndex: 50,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.82)",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    color: "#F8FAFC",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
