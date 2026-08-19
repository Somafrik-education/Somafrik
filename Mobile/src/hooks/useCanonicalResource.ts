import { useCallback, useState } from "react";
import {
  snapshotFromFailure,
  snapshotFromSuccess,
  type ResourceSnapshot,
} from "../lib/dataTruth";

export function useCanonicalResource<T>(loader: () => Promise<T[]>) {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot<T>>({ status: "idle", data: [] });

  const load = useCallback(async () => {
    setSnapshot((current) => ({ ...current, status: "loading" }));
    try {
      const rows = await loader();
      setSnapshot(snapshotFromSuccess(rows));
      return rows;
    } catch (error) {
      setSnapshot((current) => snapshotFromFailure(error, current.data));
      return null;
    }
  }, [loader]);

  const replace = useCallback((rows: T[]) => {
    setSnapshot(snapshotFromSuccess(rows));
  }, []);

  return { snapshot, load, replace };
}
