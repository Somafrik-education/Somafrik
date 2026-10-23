import { api } from "../api/client";
import {
  proofsFromSecrets,
  splitPreparePayload,
  toPublicBatchView,
  type ClassCardPreflight,
  type PrepareSplit,
  type PreparedCardSecret,
  type PublicBatchView,
} from "./studentCardBatchSession";

function classPath(classCode: string): string {
  return `/classes/${encodeURIComponent(classCode)}/student-cards`;
}

function batchPath(classCode: string, batchId: string): string {
  return `${classPath(classCode)}/batches/${encodeURIComponent(batchId)}`;
}

async function publicPost(path: string, body: unknown): Promise<PublicBatchView> {
  const raw = await api.post<unknown>(path, body);
  return toPublicBatchView(raw);
}

/**
 * Client du lot de classe. Le corps de préparation est vide : le serveur
 * reconstruit le plan. Les secrets ne sortent que de `prepare`, une seule fois.
 */
export const studentCardBatchApi = {
  preflight(classCode: string) {
    return api.get<ClassCardPreflight>(`${classPath(classCode)}/preflight`);
  },
  async prepare(classCode: string): Promise<PrepareSplit> {
    const raw = await api.post<unknown>(`${classPath(classCode)}/batches`, {});
    return splitPreparePayload(raw);
  },
  read(classCode: string, batchId: string) {
    return api.get<unknown>(batchPath(classCode, batchId)).then(toPublicBatchView);
  },
  receiptTechnical(classCode: string, batchId: string, deliveryNonce: string) {
    return publicPost(`${batchPath(classCode, batchId)}/receipt`, { kind: "technical", deliveryNonce });
  },
  receiptSaved(classCode: string, batchId: string, secrets: readonly PreparedCardSecret[]) {
    return publicPost(`${batchPath(classCode, batchId)}/receipt`, {
      kind: "saved",
      proofs: proofsFromSecrets(secrets),
    });
  },
  activate(classCode: string, batchId: string, secrets: readonly PreparedCardSecret[]) {
    return publicPost(`${batchPath(classCode, batchId)}/activate`, {
      proofs: proofsFromSecrets(secrets),
    });
  },
  abort(classCode: string, batchId: string) {
    return publicPost(`${batchPath(classCode, batchId)}/abort`, {});
  },
};
