/**
 * NFC-PRES-LOCAL-PR4 — appels hors connexion du compte et leur état de synchronisation.
 *
 * « Synchroniser maintenant » n'apparaît que pour un appel envoyable ; « Corriger l'appel »
 * uniquement après une attestation serveur `not_recorded` (`describeSyncStatus`). Aucune preuve,
 * aucun corps figé n'est lu ni affiché.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { rollCallRuntime } from "../offline/rollCall/runtime/rollCallRuntime";
import { listSyncStatus, reviseSession, type RcSyncStatusRow } from "../offline/rollCall/store/repository";
import { describeSyncStatus, SYNC_COPY } from "../offline/rollCall/sync/syncStatus";

type SessionLike = Parameters<ReturnType<typeof rollCallRuntime>["activate"]>[0];

type Props = {
  session: SessionLike;
  /** Limite l'affichage à un appel (classe + jour), dans l'écran d'appel. */
  filter?: { classId: string; date: string };
  classNameOf?: (classId: string) => string;
  /** Après « Corriger l'appel » : réouverture du brouillon révisé. */
  onCorrected?: (target: { classId: string; date: string }) => void;
};

const TONE = {
  ok: { backgroundColor: "#DCFCE7", color: "#166534" },
  neutral: { backgroundColor: "#E0E7FF", color: "#3730A3" },
  warn: { backgroundColor: "#FEF3C7", color: "#92400E" },
  error: { backgroundColor: "#FEE2E2", color: "#991B1B" },
} as const;

export default function OfflineRollCallSyncList({ session, filter, classNameOf, onCorrected }: Props) {
  const [rows, setRows] = useState<RcSyncStatusRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Base déjà ouverte pour le compte uniquement : jamais de création pour afficher la liste.
    const account = rollCallRuntime().current();
    if (!account) {
      setRows([]);
      return;
    }
    const all = await listSyncStatus(account.ctx);
    setRows(filter ? all.filter((row) => row.class_id === filter.classId && row.roll_call_date === filter.date) : all);
  }, [filter]);

  useEffect(() => {
    void load().catch(() => setRows([]));
    return rollCallRuntime().subscribeSync(() => {
      void load().catch(() => undefined);
    });
  }, [load]);

  const syncNow = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const report = await rollCallRuntime().requestSync(session, "manual");
      if (report && report.synced > 0) setNotice(SYNC_COPY.syncedSuccess);
      else if (report && report.attempted === 0) setNotice(SYNC_COPY.cooldown);
      await load();
    } finally {
      setBusy(false);
    }
  }, [load, session]);

  const correct = useCallback(async (row: RcSyncStatusRow) => {
    const account = rollCallRuntime().current();
    if (!account) return;
    setBusy(true);
    try {
      // Refusé par le stockage (trigger PR2) sans attestation not_recorded.
      await reviseSession(account.ctx, row.session_id);
      await rollCallRuntime().refreshLogoutGuard(session);
      await load();
      onCorrected?.({ classId: row.class_id, date: row.roll_call_date });
    } catch {
      setNotice("Correction impossible pour cet appel.");
    } finally {
      setBusy(false);
    }
  }, [load, onCorrected, session]);

  if (rows === null) return <ActivityIndicator color="#2563EB" />;
  const visible = rows;
  if (visible.length === 0) return filter ? null : <Text style={styles.empty} testID="offline-sync-empty">{SYNC_COPY.empty}</Text>;
  const now = Date.now();
  return (
    <View testID="offline-sync-list" accessibilityLiveRegion="polite">
      {notice ? <Text style={[styles.badge, TONE.ok]} testID="offline-sync-notice">{notice}</Text> : null}
      {visible.map((row) => {
        const view = describeSyncStatus(row, now);
        return (
          <View key={row.session_id} style={styles.card} testID={`offline-sync-row-${row.state}`}>
            <Text style={styles.title}>
              {(classNameOf?.(row.class_id) || "Classe")} — {row.roll_call_date}
            </Text>
            <Text style={[styles.badge, TONE[view.tone]]} accessibilityRole="text">{view.label}</Text>
            {view.message ? <Text style={styles.message}>{view.message}</Text> : null}
            <Text style={styles.meta}>
              Tentatives : {row.attempt_count}
              {row.last_attempt_at ? ` · dernière : ${row.last_attempt_at.slice(0, 16).replace("T", " à ")} UTC` : ""}
            </Text>
            <View style={styles.actions}>
              {view.canSyncNow ? (
                <TouchableOpacity testID="offline-sync-now" style={styles.button} disabled={busy} onPress={() => void syncNow()} accessibilityRole="button">
                  <Text style={styles.buttonText}>{SYNC_COPY.syncNow}</Text>
                </TouchableOpacity>
              ) : null}
              {view.canCorrect ? (
                <TouchableOpacity testID="offline-sync-correct" style={[styles.button, styles.secondary]} disabled={busy} onPress={() => void correct(row)} accessibilityRole="button">
                  <Text style={[styles.buttonText, styles.secondaryText]}>{SYNC_COPY.correct}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
      {busy ? <ActivityIndicator color="#2563EB" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: "#FFFFFF" },
  title: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 6 },
  badge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, fontWeight: "600", overflow: "hidden" },
  message: { marginTop: 6, fontSize: 14, color: "#374151" },
  meta: { marginTop: 6, fontSize: 12, color: "#6B7280" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  button: { backgroundColor: "#2563EB", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
  secondary: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#2563EB" },
  secondaryText: { color: "#2563EB" },
  empty: { fontSize: 14, color: "#6B7280" },
});
