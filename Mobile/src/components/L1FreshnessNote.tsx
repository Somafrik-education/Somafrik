import { Text } from "react-native";
import type { ResourceSnapshot } from "../lib/dataTruth";
import { L1_FRESHNESS_TEST_ID, l1FreshnessLabel } from "../lib/l1Freshness";

/** PERF-PR5 — ligne discrète de fraîcheur pour une copie L1 (aucune notification). */
export default function L1FreshnessNote({
  snapshot,
  permissionsBootstrap,
}: {
  snapshot: Pick<ResourceSnapshot<unknown>, "source" | "cachedAt" | "refreshing" | "refreshFailed">;
  permissionsBootstrap?: string | null;
}) {
  const label = l1FreshnessLabel(snapshot, { permissionsBootstrap });
  if (!label) return null;
  return (
    <Text
      testID={L1_FRESHNESS_TEST_ID}
      accessibilityLiveRegion="polite"
      style={{ color: "#475569", fontSize: 12, marginBottom: 8 }}
    >
      {label}
    </Text>
  );
}
