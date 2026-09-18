import { Pressable, StyleSheet, Text } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

export function HelpTrigger({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ouvrir l’aide"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={styles.trigger}
      testID="help-trigger"
    >
      <Text style={styles.mark} accessibilityElementsHidden>
        ?
      </Text>
      <Text style={styles.label}>Besoin d’aide ?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    position: "absolute",
    right: 16,
    bottom: 96,
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#1d4ed8",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    elevation: 8,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 30,
  },
  mark: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  label: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
});
