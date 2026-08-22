import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";

type Option = { id: string; label: string };

export default function ChoiceChips({
  label,
  options,
  selectedId,
  onSelect,
  disabled,
}: {
  label: string;
  options: Option[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {options.map((option) => {
          const active = option.id === selectedId;
          return (
            <TouchableOpacity
              key={option.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onSelect(option.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${option.label}`}
              accessibilityState={{ selected: active, disabled }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 10 },
  label: { color: "#334155", fontSize: 12, fontWeight: "900", marginBottom: 6 },
  row: { gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET_DP,
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  chipActive: { backgroundColor: "#0F172A" },
  chipText: { color: "#475569", fontWeight: "800" },
  chipTextActive: { color: "#FFFFFF" },
});
