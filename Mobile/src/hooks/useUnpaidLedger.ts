import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  snapshotFromFailure,
  snapshotFromSuccess,
  type ResourceSnapshot,
} from "../lib/dataTruth";
import {
  classifyUnpaidError,
  unpaidStudentCount,
  type UnpaidGate,
  type UnpaidStudentRow,
} from "../lib/unpaidLedger";
import { listUnpaid } from "../services/api";

const IDLE: ResourceSnapshot<UnpaidStudentRow> = { status: "idle", data: [] };

export function useUnpaidLedger(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot<UnpaidStudentRow>>(IDLE);
  const [gate, setGate] = useState<UnpaidGate>("ok");

  const reload = useCallback(async () => {
    if (!enabled) {
      setSnapshot(IDLE);
      setGate("ok");
      return;
    }
    setSnapshot((current) => ({ ...current, status: "loading" }));
    setGate("ok");
    try {
      const rows = await listUnpaid();
      setSnapshot(snapshotFromSuccess(rows));
    } catch (error) {
      const classified = classifyUnpaidError(error);
      setGate(classified.gate);
      if (classified.gate !== "ok") {
        setSnapshot({ status: "error", data: [], errorMessage: classified.message });
        return;
      }
      setSnapshot(snapshotFromFailure(error));
    }
  }, [enabled]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return {
    snapshot,
    gate,
    reload,
    rows: snapshot.data,
    studentCount: unpaidStudentCount(snapshot.data),
  };
}
