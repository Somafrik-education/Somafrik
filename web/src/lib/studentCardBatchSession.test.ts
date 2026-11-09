import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import type { PermissionContext } from "./permissions";
import type { SessionUser } from "../types";
import {
  automaticBatchCalls,
  canActivateBatch,
  canConfirmDocumentSave,
  canIssueClassStudentCards,
  classifyBatchError,
  explicitPrepareAllowed,
  initialBatchFlow,
  readPendingBatch,
  reduceBatchFlow,
  saveStudentCardBatchDocument,
  splitPreparePayload,
  toPublicBatchView,
} from "./studentCardBatchSession";

const SECRET = "supersecretvalue";
const TOKEN = `pubidvalue.${SECRET}`;
const BATCH_ID = "11111111-1111-4111-8111-111111111111";

function ctx(role: string, permissions?: string[], schoolId = "school-a"): PermissionContext {
  return {
    user: {
      id: "user-1",
      role,
      schoolId,
      schoolCode: "CD-IN-26-001",
      permissions,
    } as SessionUser,
    rolePermissions: {},
  };
}

describe("droits scolaires de l'émission par classe", () => {
  it("autorise l'administrateur scolaire et refuse la plateforme, le pays et la lecture seule", () => {
    expect(canIssueClassStudentCards(ctx(SCHOOL_ADMIN_ROLE))).toBe(true);
    expect(canIssueClassStudentCards(ctx("Directeur"))).toBe(true);
    expect(canIssueClassStudentCards(ctx("Secrétaire"))).toBe(true);
    expect(canIssueClassStudentCards(ctx(SCHOOL_ADMIN_ROLE, ["Élèves:UPDATE"], "school-b"))).toBe(true);
    expect(canIssueClassStudentCards(ctx(SCHOOL_ADMIN_ROLE, ["Classes:UPDATE", "Élèves:READ"]))).toBe(false);
    expect(canIssueClassStudentCards(ctx("Enseignant"))).toBe(false);
    expect(canIssueClassStudentCards(ctx("Comptable"))).toBe(false);
    expect(canIssueClassStudentCards(ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES", "Élèves:UPDATE"]))).toBe(false);
    expect(canIssueClassStudentCards(ctx(COUNTRY_ADMIN_ROLE, ["ALL_PRIVILEGES", "Élèves:UPDATE"]))).toBe(false);
  });
});

describe("session du lot", () => {
  it("ne relance rien automatiquement", () => {
    expect(automaticBatchCalls()).toEqual([]);
    const pending = reduceBatchFlow(initialBatchFlow("CLS-1"), {
      type: "failure",
      failure: classifyBatchError(
        new ApiError("pending", 409, "STUDENT_CARD_BATCH_PENDING", {
          batchId: BATCH_ID,
          status: "prepared",
          classCode: "CLS-1",
          expiresAt: "2026-10-23T18:00:00.000Z",
          secretsRecoverable: true,
          publicIds: ["pubidvalue", TOKEN],
          cardToken: TOKEN,
        }),
      ),
    });
    expect(pending.phase).toBe("pending_blocked");
    expect(pending.secretsRecoverable).toBe(false);
    expect(pending.secretsHeld).toBe(false);
    expect(pending.publicIds).toEqual(["pubidvalue"]);
    expect(JSON.stringify(pending)).not.toContain(SECRET);
    expect(explicitPrepareAllowed(pending)).toBe(false);
  });

  it("retire les secrets d'une reprise et d'une préparation illisible", () => {
    const view = toPublicBatchView({
      batchId: BATCH_ID,
      status: "received",
      deliveryNonce: "nonce-value",
      entries: [{ studentId: "student-1", publicId: "pubidvalue", cardToken: TOKEN, outcome: "prepared" }],
    });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(view.secretsIncluded).toBe(false);
    const broken = splitPreparePayload({
      secretsIncluded: true,
      deliveryNonce: "nonce-value",
      batchId: BATCH_ID,
      status: "prepared",
      entries: [{ studentId: "student-1", decision: "prepared", publicId: "other", cardToken: TOKEN }],
    });
    expect(broken.ok).toBe(false);
    expect(broken.secrets).toEqual([]);
    expect(JSON.stringify(broken.view)).not.toContain(SECRET);
  });

  it("exige la sauvegarde vérifiée et la confirmation avant l'activation", () => {
    let state = reduceBatchFlow(initialBatchFlow("CLS-1"), {
      type: "prepared",
      view: {
        batchId: BATCH_ID,
        classCode: "CLS-1",
        className: "6ème A",
        status: "prepared",
        expiresAt: null,
        receivedAt: null,
        savedAt: null,
        activatedAt: null,
        secretsIncluded: false,
        secretsRecoverable: false,
        counts: { prepared: 1 },
        entries: [],
      },
      secretsHeld: true,
      nonceHeld: true,
    });
    state = reduceBatchFlow(state, {
      type: "received",
      view: { ...state, status: "received", entries: state.entries, counts: {}, secretsIncluded: false, secretsRecoverable: false, batchId: BATCH_ID, classCode: "CLS-1", className: "6ème A", expiresAt: null, receivedAt: null, savedAt: null, activatedAt: null },
    });
    expect(canActivateBatch(state)).toBe(false);
    expect(canConfirmDocumentSave(state)).toBe(false);
    state = reduceBatchFlow(state, { type: "operator_confirmed", confirmed: true });
    expect(canConfirmDocumentSave(state)).toBe(false);
    const tokenFile = reduceBatchFlow(state, { type: "document_saved", bytesWritten: 120, printableConverted: false });
    expect(canConfirmDocumentSave(tokenFile)).toBe(false);
    expect(canActivateBatch(tokenFile)).toBe(false);
    state = reduceBatchFlow(state, { type: "document_saved", bytesWritten: 120, printableConverted: true });
    expect(canConfirmDocumentSave(state)).toBe(true);
    expect(canActivateBatch(state)).toBe(false);
    state = reduceBatchFlow(state, {
      type: "saved",
      view: {
        batchId: BATCH_ID,
        classCode: "CLS-1",
        className: "6ème A",
        status: "saved",
        expiresAt: null,
        receivedAt: null,
        savedAt: null,
        activatedAt: null,
        secretsIncluded: false,
        secretsRecoverable: false,
        counts: {},
        entries: [],
      },
    });
    expect(state.phase).toBe("awaiting_activation");
    expect(canActivateBatch(state)).toBe(true);
  });

  it("une réponse perdue pendant la préparation n'ouvre pas une nouvelle émission", () => {
    const preparing = reduceBatchFlow(initialBatchFlow("CLS-1"), { type: "preparing" });
    const lost = reduceBatchFlow(preparing, { type: "response_lost" });
    expect(lost.phase).toBe("response_lost");
    expect(lost.secretsHeld).toBe(false);
    expect(lost.message).toMatch(/Aucune nouvelle émission automatique/);
    expect(explicitPrepareAllowed(lost)).toBe(true);
  });

  it("ignore un 409 dont le détail prétend rendre les secrets récupérables", () => {
    const pending = readPendingBatch({
      batchId: BATCH_ID,
      secretsRecoverable: true,
      publicIds: ["pubidvalue"],
      cardToken: TOKEN,
    });
    expect(pending?.secretsRecoverable).toBe(false);
    expect(JSON.stringify(pending)).not.toContain(SECRET);
  });

  it("confirme la sauvegarde du fichier choisi par l'opérateur", async () => {
    const text = "<!DOCTYPE html><html><body>CR80</body></html>";
    const writes: string[] = [];
    const saved = await saveStudentCardBatchDocument(text, "cartes-CLS-1.txt", {
      showSaveFilePicker: async () => ({
        createWritable: async () => ({
          write: async (data: string) => {
            writes.push(data);
          },
          close: async () => undefined,
        }),
      }),
    });
    expect(saved.verified).toBe(true);
    expect(saved.method).toBe("file-picker");
    expect(writes).toEqual([text]);

    const cancelled = await saveStudentCardBatchDocument(text, "cartes-CLS-1.txt", {
      showSaveFilePicker: async () => {
        const error = new Error("annulé");
        error.name = "AbortError";
        throw error;
      },
      document: {
        createElement: () => {
          throw new Error("le téléchargement ne doit pas remplacer une annulation");
        },
      } as unknown as Document,
    });
    expect(cancelled.verified).toBe(false);
    expect(cancelled.cancelled).toBe(true);
  });

  it("isole l'échec d'un autre établissement sans reprendre ses détails", () => {
    const failure = classifyBatchError(
      new ApiError("classe", 404, "STUDENT_CARD_CLASS_NOT_FOUND", {
        students: [{ id: "other-school-student", cardToken: TOKEN }],
      }),
    );
    const state = reduceBatchFlow(initialBatchFlow("CLS-9"), { type: "failure", failure });
    expect(state.phase).toBe("not_found");
    expect(state.entries).toEqual([]);
    expect(JSON.stringify(state)).not.toContain("other-school-student");
    expect(JSON.stringify(failure)).not.toContain(SECRET);
    const denied = classifyBatchError(new ApiError("plateforme", 403, "PLATFORM_PERSONAL_DATA_DENIED"));
    expect(reduceBatchFlow(initialBatchFlow("CLS-9"), { type: "failure", failure: denied }).phase).toBe("denied");
  });
});
