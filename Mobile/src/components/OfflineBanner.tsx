import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAdminData } from "../context/AdminDataContext";
import { useAuth } from "../context/AuthContext";
import { OFFLINE_COPY, OFFLINE_TEST_IDS } from "../lib/offlineModeSpec";
import { countPendingIn, listOutbox, subscribeOutbox, type OutboxEntry } from "../lib/outbox";

export default function OfflineBanner() {
  const { syncStatus } = useAdminData();
  const { session, permissionsBootstrap } = useAuth();
  const [pending, setPending] = useState<number | null>(0);
  const rightsUnrevalidated = permissionsBootstrap === "ready_offline";

  useEffect(() => {
    if (!session) {
      setPending(0);
      return undefined;
    }
    const fingerprint = {
      userId: String(session.user?.id ?? ""),
      schoolScope: String(session.school?.code ?? session.user?.schoolCode ?? "").toUpperCase(),
    };
    const apply = (entries: OutboxEntry[]) => {
      setPending(countPendingIn(entries, fingerprint));
    };
    void listOutbox()
      .then(apply)
      .catch(() => {
        setPending(null);
      });
    const unsubscribe = subscribeOutbox(apply);
    return unsubscribe;
  }, [session, session?.user?.id, session?.school?.code]);

  if (syncStatus === "syncing") {
    return null;
  }

  if (syncStatus === "offline" || rightsUnrevalidated) {
    return (
      <View style={styles.banner} testID={OFFLINE_TEST_IDS.banner} accessibilityRole="alert">
        <Ionicons name="cloud-offline-outline" size={18} color="#92400E" />
        <View style={styles.textWrap}>
          <Text style={styles.title} testID={OFFLINE_TEST_IDS.bannerTitle}>
            {rightsUnrevalidated ? OFFLINE_COPY.permissionsUnrevalidated : OFFLINE_COPY.bannerTitle}
          </Text>
          <Text style={styles.hint} testID={OFFLINE_TEST_IDS.bannerHint}>
            {OFFLINE_COPY.bannerHint}
          </Text>
          {pending === null ? (
            <Text style={styles.hint} testID={OFFLINE_TEST_IDS.outboxUnread}>
              {OFFLINE_COPY.outboxUnread}
            </Text>
          ) : pending > 0 ? (
            <Text style={styles.hint} testID={OFFLINE_TEST_IDS.pendingCount}>
              {pending} {OFFLINE_COPY.pendingOutbox}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FEF3C7",
    borderBottomWidth: 1,
    borderBottomColor: "#FCD34D",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: "#92400E",
    fontWeight: "900",
    fontSize: 14,
  },
  hint: {
    color: "#B45309",
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 16,
  },
});
