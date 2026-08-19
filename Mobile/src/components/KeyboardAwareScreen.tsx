import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type Props = {
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
  style?: StyleProp<ViewStyle>;
  keyboardVerticalOffset?: number;
} & Omit<ScrollViewProps, "contentContainerStyle" | "style">;

export default function KeyboardAwareScreen({
  children,
  testID,
  accessibilityLabel,
  contentContainerStyle,
  style,
  keyboardVerticalOffset,
  ...scrollProps
}: Props) {
  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={Platform.OS === "ios" ? "padding" : "padding"}
      keyboardVerticalOffset={keyboardVerticalOffset ?? (Platform.OS === "android" ? 8 : 0)}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        {...scrollProps}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function KeyboardAvoidingContainer({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <KeyboardAvoidingView
      style={[styles.flex, style]}
      behavior={Platform.OS === "ios" ? "padding" : "padding"}
      keyboardVerticalOffset={Platform.OS === "android" ? 8 : 0}
      testID={testID}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
