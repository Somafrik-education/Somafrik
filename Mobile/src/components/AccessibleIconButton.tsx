import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ICON_HIT_SLOP, MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

type IconName = ComponentProps<typeof Ionicons>["name"];

type Props = {
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  busy?: boolean;
  icon?: IconName;
  iconSize?: number;
  iconColor?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function AccessibleIconButton({
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled,
  selected,
  busy,
  icon,
  iconSize = 20,
  iconColor = "#0F172A",
  children,
  style,
  testID,
}: Props) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(selected), busy: Boolean(busy) }}
      hitSlop={ICON_HIT_SLOP}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={[styles.button, style]}
    >
      {icon ? <Ionicons name={icon} size={iconSize} color={iconColor} /> : null}
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: MIN_TOUCH_TARGET_DP,
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
  },
});
