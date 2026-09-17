import { StyleSheet, Text, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../../lib/mobileUsability";
import { schoolSetupOptionalCompleteness } from "../../lib/schoolSetupMobile";
import type { SchoolSetupPayload } from "../../lib/schoolSetupStatusApi";

const OPTIONAL_KEYS = ["periods", "teachers", "students", "feeGrids", "notifications"] as const;

export function SchoolSetupOptionalCompleteness({ payload }: { payload: SchoolSetupPayload }) {
  const optional = payload.optional;
  const items = schoolSetupOptionalCompleteness(payload);
  const byId = new Map(items.map((item) => [item.id, item]));

  return (
    <View style={styles.card} testID="school-setup-optional-completeness">
      <Text style={styles.title}>Complétude recommandée</Text>
      <Text style={styles.description}>
        Pour aller plus loin : ces indicateurs restent informatifs et ne bloquent pas la configuration essentielle.
      </Text>
      {OPTIONAL_KEYS.map((id) => {
        const item = byId.get(id);
        const done = Boolean(optional?.[id] ?? item?.done);
        return (
          <View key={id} style={styles.row} testID={`school-setup-optional-${id}`}>
            <Text style={styles.label}>{item?.label ?? id}</Text>
            <Text style={done ? styles.done : styles.missing}>{done ? "Configuré" : "À compléter"}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 16,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  description: { fontSize: 14, fontWeight: "500", color: "#64748B", lineHeight: 20 },
  row: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  done: { fontSize: 13, fontWeight: "700", color: "#15803D" },
  missing: { fontSize: 13, fontWeight: "700", color: "#C2410C" },
});
