import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { FORM_ERROR_COLOR, FORM_LABEL_COLOR, formatFieldLabel } from "../lib/formFieldTokens";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

type Option = { id: string; label: string };

export default function ChoiceChips({
  label,
  options,
  selectedId,
  onSelect,
  disabled,
  required,
  optional,
  error,
}: {
  label: string;
  options: Option[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  required?: boolean;
  optional?: boolean;
  error?: string;
}) {
  const visibleLabel = formatFieldLabel(label, { required, optional });
  const invalid = Boolean(error && String(error).trim());
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{visibleLabel}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {options.map((option) => {
          const active = option.id === selectedId;
          return (
            <TouchableOpacity
              key={option.id}
              style={[styles.chip, active && styles.chipActive, invalid && !active && styles.chipInvalid]}
              onPress={() => onSelect(option.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${visibleLabel} ${option.label}`}
              accessibilityState={{ selected: active, disabled }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {invalid ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 10 },
  label: { color: FORM_LABEL_COLOR, fontSize: 12, fontWeight: "900", marginBottom: 6 },
  row: { gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  chipActive: { backgroundColor: "#0F172A" },
  chipInvalid: { borderWidth: 1, borderColor: FORM_ERROR_COLOR },
  chipText: { color: "#475569", fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
  error: { color: FORM_ERROR_COLOR, fontWeight: "800", marginTop: 6 },
});
