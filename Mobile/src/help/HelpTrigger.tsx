import { Pressable, StyleSheet, Text } from "react-native";
import {
  HELP_TRIGGER_HIT_SLOP,
  HELP_TRIGGER_SIDE_INSET_DP,
  HELP_TRIGGER_VISUAL_DP,
  helpTriggerBottomOffset,
} from "./helpTriggerLayout";

export function HelpTrigger({
  expanded,
  onPress,
  onHide,
  bottom,
}: {
  expanded: boolean;
  onPress: () => void;
  onHide?: () => void;
  bottom?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Besoin d'aide"
      accessibilityState={{ expanded }}
      onPress={onPress}
      onLongPress={onHide}
      delayLongPress={420}
      hitSlop={HELP_TRIGGER_HIT_SLOP}
      style={[styles.trigger, { bottom: bottom ?? helpTriggerBottomOffset() }]}
      testID="mobile-help-button"
    >
      <Text style={styles.mark} accessibilityElementsHidden>
        ?
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    position: "absolute",
    right: HELP_TRIGGER_SIDE_INSET_DP,
    width: HELP_TRIGGER_VISUAL_DP,
    height: HELP_TRIGGER_VISUAL_DP,
    borderRadius: HELP_TRIGGER_VISUAL_DP / 2,
    backgroundColor: "#1d4ed8",
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 30,
  },
  mark: { color: "#FFFFFF", fontSize: 18, fontWeight: "800", lineHeight: 20 },
});
