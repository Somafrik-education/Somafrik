import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  EMPTY_UNPAID_LEDGER,
  classifyUnpaidLedgerFailure,
  type UnpaidLedgerState,
} from "../lib/unpaidLedger";
import { getUnpaidLedger } from "../services/api";

export function useUnpaidLedger(enabled: boolean, requestedSchoolCode?: string | null) {
  const requestIdRef = useRef(0);
  const [state, setState] = useState<UnpaidLedgerState>({
    ...EMPTY_UNPAID_LEDGER,
    status: enabled ? "idle" : "hidden",
  });

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!enabled) {
      setState({ ...EMPTY_UNPAID_LEDGER, status: "hidden" });
      return;
    }

    setState((current) => ({ ...current, status: "loading", errorMessage: undefined }));
    try {
      const ledger = await getUnpaidLedger(requestedSchoolCode);
      if (requestIdRef.current !== requestId) return;
      setState({
        ...ledger,
        status: ledger.studentCount > 0 ? "success" : "empty",
      });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setState({
        ...EMPTY_UNPAID_LEDGER,
        ...classifyUnpaidLedgerFailure(error),
      });
    }
  }, [enabled, requestedSchoolCode]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        requestIdRef.current += 1;
      };
    }, [refresh]),
  );

  return { state, refresh };
}
