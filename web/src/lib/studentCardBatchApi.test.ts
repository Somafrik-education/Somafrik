import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, post } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { studentCardBatchApi } from "./studentCardBatchApi";

const TOKEN = "pubidvalue.supersecretvalue";

describe("studentCardBatchApi", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("précontrôle la classe sans identifiant d'établissement", async () => {
    get.mockResolvedValue({ classCode: "6A/1", entries: [], counts: { issueCandidates: 1, alreadyActive: 0, ineligible: 0 } });
    await studentCardBatchApi.preflight("6A/1");
    expect(get).toHaveBeenCalledWith("/classes/6A%2F1/student-cards/preflight");
    expect(JSON.stringify(get.mock.calls)).not.toContain("schoolId");
  });

  it("prépare avec un corps vide et retire les secrets de la vue publique", async () => {
    post.mockResolvedValue({
      batchId: "11111111-1111-4111-8111-111111111111",
      status: "prepared",
      secretsIncluded: true,
      deliveryNonce: "nonce-value",
      entries: [
        { studentId: "student-active", decision: "already_active", publicId: "activepub", scannable: true },
        {
          studentId: "student-new",
          decision: "prepared",
          publicId: "pubidvalue",
          cardToken: TOKEN,
          scannable: false,
        },
      ],
      counts: { prepared: 1, alreadyActive: 1, ineligible: 0 },
    });
    const split = await studentCardBatchApi.prepare("CLS-1");
    expect(post).toHaveBeenCalledWith("/classes/CLS-1/student-cards/batches", {});
    expect(JSON.stringify(post.mock.calls)).not.toContain("Idempotency-Key");
    expect(split.ok).toBe(true);
    expect(split.nonce).toBe("nonce-value");
    expect(split.secrets).toEqual([
      { studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: "supersecretvalue" },
    ]);
    expect(JSON.stringify(split.view)).not.toContain("supersecretvalue");
    expect(JSON.stringify(split.view)).not.toContain("nonce-value");
    expect(split.view.secretsIncluded).toBe(false);
    expect(split.view.secretsRecoverable).toBe(false);
  });

  it("lit, accuse, active et abandonne sans réécrire un secret dans la réponse", async () => {
    const raw = {
      batchId: "11111111-1111-4111-8111-111111111111",
      status: "received",
      cardToken: TOKEN,
      deliveryNonce: "nonce-value",
      entries: [{ studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, outcome: "prepared" }],
      counts: {},
    };
    get.mockResolvedValue(raw);
    post.mockResolvedValue(raw);
    const view = await studentCardBatchApi.read("CLS-1", "lot/1");
    expect(get).toHaveBeenCalledWith("/classes/CLS-1/student-cards/batches/lot%2F1");
    expect(JSON.stringify(view)).not.toContain("supersecretvalue");
    expect(view.secretsRecoverable).toBe(false);

    const secrets = [{ studentId: "student-new", publicId: "pubidvalue", cardToken: TOKEN, secret: "supersecretvalue" }];
    await studentCardBatchApi.receiptTechnical("CLS-1", "lot-1", "nonce-value");
    await studentCardBatchApi.receiptSaved("CLS-1", "lot-1", secrets);
    await studentCardBatchApi.activate("CLS-1", "lot-1", secrets);
    await studentCardBatchApi.abort("CLS-1", "lot-1");
    expect(post).toHaveBeenNthCalledWith(1, "/classes/CLS-1/student-cards/batches/lot-1/receipt", {
      kind: "technical",
      deliveryNonce: "nonce-value",
    });
    expect(post).toHaveBeenNthCalledWith(2, "/classes/CLS-1/student-cards/batches/lot-1/receipt", {
      kind: "saved",
      proofs: [{ publicId: "pubidvalue", secret: "supersecretvalue" }],
    });
    expect(post).toHaveBeenNthCalledWith(3, "/classes/CLS-1/student-cards/batches/lot-1/activate", {
      proofs: [{ publicId: "pubidvalue", secret: "supersecretvalue" }],
    });
    expect(post).toHaveBeenNthCalledWith(4, "/classes/CLS-1/student-cards/batches/lot-1/abort", {});
    expect(JSON.stringify(post.mock.calls[0])).not.toContain("schoolId");
  });
});
