import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { ROLL_CALL_OVERVIEW_COPY, parseRollCallOverview, type RollCallOverview } from "../lib/studentCardRollCallRoles";
import { getRollCallOverview } from "../services/studentCardRollCallApi";

/** CARTE-UX-ROLE-01 — supervision de direction : compteurs par classe, aucune donnée d'élève. */
export default function StudentCardRollCallOverview({ date }: { date: string }) {
  const [overview, setOverview] = useState<RollCallOverview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const own = ++generation.current;
    setState("loading");
    try {
      const parsed = parseRollCallOverview(await getRollCallOverview(date));
      if (own !== generation.current) return;
      setOverview(parsed);
      setState(parsed ? "idle" : "failed");
    } catch {
      if (own === generation.current) setState("failed");
    }
  }, [date]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return (
    <View style={styles.card} testID="attendance-roll-call-overview">
      <Text style={styles.title}>{ROLL_CALL_OVERVIEW_COPY.title}</Text>
      <Text style={styles.subtitle}>{ROLL_CALL_OVERVIEW_COPY.subtitle}</Text>
      {state === "loading" ? <ActivityIndicator color="#2563EB" accessibilityLabel={ROLL_CALL_OVERVIEW_COPY.loading} /> : null}
      {state === "failed" ? <Text style={styles.error}>{ROLL_CALL_OVERVIEW_COPY.failed}</Text> : null}
      {overview && overview.classes.length === 0 ? <Text style={styles.line}>{ROLL_CALL_OVERVIEW_COPY.empty}</Text> : null}
      {overview?.classes.map((row) => (
        <View key={row.classId} style={styles.row} testID={`roll-call-overview-${row.classId}`}>
          <Text style={styles.className}>{row.className || row.classCode}</Text>
          <Text style={[styles.status, row.status === "complete" ? styles.complete : row.status === "partial" ? styles.partial : styles.notStarted]}>
            {ROLL_CALL_OVERVIEW_COPY.status[row.status]}
          </Text>
          <Text style={styles.line}>{ROLL_CALL_OVERVIEW_COPY.line(row)}</Text>
        </View>
      ))}
      <TouchableOpacity
        testID="attendance-roll-call-overview-refresh"
        style={styles.refresh}
        onPress={() => void load()}
        disabled={state === "loading"}
        accessibilityRole="button"
        accessibilityState={{ disabled: state === "loading" }}
      >
        <Text style={styles.refreshText}>{ROLL_CALL_OVERVIEW_COPY.refresh}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E2E8F0" },
  title: { color: "#0F172A", fontWeight: "900", fontSize: 16 },
  subtitle: { marginTop: 4, color: "#64748B", fontWeight: "700" },
  error: { marginTop: 8, color: "#B45309", fontWeight: "800" },
  row: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  className: { color: "#0F172A", fontWeight: "900" },
  status: { marginTop: 2, fontWeight: "900" },
  complete: { color: "#166534" },
  partial: { color: "#B45309" },
  notStarted: { color: "#64748B" },
  line: { marginTop: 2, color: "#334155", fontWeight: "700" },
  refresh: {
    marginTop: 12, minHeight: MIN_TOUCH_TARGET_DP, borderRadius: 12, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
  },
  refreshText: { color: "#334155", fontWeight: "900" },
});
