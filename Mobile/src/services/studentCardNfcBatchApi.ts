import { httpRequest } from "./httpClient";
import {
  createBatchRosterLoader,
  type BatchScope,
} from "../lib/studentCardNfcBatchRoster";
export const studentCardNfcBatchRoster = (scope: BatchScope) =>
  createBatchRosterLoader(
    <T>(path: string) => httpRequest<T>(path, { cache: "no-store" }),
    scope,
  );
