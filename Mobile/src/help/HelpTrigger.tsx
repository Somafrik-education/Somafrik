import { Pressable, StyleSheet, Text } from "react-native";
import { HELP_TRIGGER_SIZE_DP, HELP_TRIGGER_ZINDEX } from "./helpOverlayPolicy";

export const HELP_TEST_IDS = {
  trigger: "help-trigger",
  sheet: "help-sheet",
  search: "help-search-input",
  close: "help-close",
  back: "help-back",
  navigate: "help-navigate-screen",
} as const;

type Props = {
  onPress: () => void;
  expanded: boolean;
  bottom: number;
  right: number;
};

export default function HelpTrigger({ onPress, expanded, bottom, right }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir l’aide"
      accessibilityState={{ expanded }}
      accessibilityHint="Ouvre Besoin d’aide pour l’écran en cours"
      testID={HELP_TEST_IDS.trigger}
      hitSlop={8}
      style={({ pressed }) => [
        styles.trigger,
        { bottom, right, opacity: pressed ? 0.88 : 1 },
      ]}
    >
      <Text style={styles.mark} accessibilityElementsHidden>
        ?
      </Text>
      <Text style={styles.label} maxFontSizeMultiplier={1.2} numberOfLines={1}>
        Besoin d’aide
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    position: "absolute",
    zIndex: HELP_TRIGGER_ZINDEX,
    elevation: HELP_TRIGGER_ZINDEX,
    minHeight: HELP_TRIGGER_SIZE_DP,
    minWidth: HELP_TRIGGER_SIZE_DP,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#2563EB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  mark: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 20,
  },
  label: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
