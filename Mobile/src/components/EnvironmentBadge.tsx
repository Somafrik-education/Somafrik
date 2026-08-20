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
      style={[styles.wrap, { top: Math.max(Math.min(insets.top - 18, 8), 2) }]}
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
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 40,
    borderRadius: 999,
  },
  text: {
    color: "#F8FAFC",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    overflow: "hidden",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
