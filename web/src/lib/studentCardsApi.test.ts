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

import { studentCardsApi } from "./studentCardsApi";

describe("studentCardsApi", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({ cards: [] });
    post.mockResolvedValue({});
  });

  it("liste les cartes sur GET /students/:id/cards", async () => {
    await studentCardsApi.list("stu/1");
    expect(get).toHaveBeenCalledWith("/students/stu%2F1/cards");
  });

  it("émet sans Idempotency-Key", async () => {
    await studentCardsApi.issue("stu-1", "qr");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/student-cards", { studentId: "stu-1", medium: "qr" });
    expect(JSON.stringify(post.mock.calls)).not.toContain("Idempotency-Key");
  });

  it("déclare perdue et révoque sur les routes PR2", async () => {
    await studentCardsApi.markLost("card-1", "oubli");
    await studentCardsApi.revoke("card-1");
    expect(post).toHaveBeenNthCalledWith(1, "/student-cards/card-1/lost", { reason: "oubli" });
    expect(post).toHaveBeenNthCalledWith(2, "/student-cards/card-1/revoke", {});
  });

  it("remplace sans Idempotency-Key", async () => {
    await studentCardsApi.replace("card-1");
    expect(post).toHaveBeenCalledWith("/student-cards/card-1/replace", {});
    expect(JSON.stringify(post.mock.calls)).not.toContain("Idempotency-Key");
  });
});
