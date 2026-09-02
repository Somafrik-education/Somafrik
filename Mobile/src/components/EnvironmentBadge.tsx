import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getEnvironmentBadgeLabel, shouldShowEnvironmentBadge } from "../config/env";
import { UX_V1_SPEC_VERSION } from "../lib/mobileUxV1Layout";

/** Marqueur d'environnement visible, non intrusif — jamais en production. */
export default function EnvironmentBadge() {
  if (!shouldShowEnvironmentBadge()) return null;
  const label = getEnvironmentBadgeLabel();
  if (!label) return null;
  return <EnvironmentBadgeInner label={label} />;
}

function EnvironmentBadgeInner({ label }: { label: string }) {
  const insets = useSafeAreaInsets();
  const display = `${label} · V${UX_V1_SPEC_VERSION}`;
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 2 }]}
      testID="environment-badge"
      accessibilityRole="text"
      accessibilityLabel={`Environnement ${display}`}
    >
      <Text style={styles.text}>{display}</Text>
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
