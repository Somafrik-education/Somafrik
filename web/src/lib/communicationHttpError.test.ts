import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import {
  communicationHttpErrorView,
  COMMUNICATION_HTTP_ERROR_COPY,
  usesForbiddenCommunicationState,
} from "./communicationHttpError";

describe("AUDIT-COM-P3-02 — copies HTTP Communication", () => {
  it("mappe 401/403/404/409/500 vers des titres FR distincts et un libellé HTTP visible", () => {
    const cases = [
      [401, COMMUNICATION_HTTP_ERROR_COPY[401]],
      [403, COMMUNICATION_HTTP_ERROR_COPY[403]],
      [404, COMMUNICATION_HTTP_ERROR_COPY[404]],
      [409, COMMUNICATION_HTTP_ERROR_COPY[409]],
      [500, COMMUNICATION_HTTP_ERROR_COPY[500]],
      [503, COMMUNICATION_HTTP_ERROR_COPY[500]],
    ] as const;

    for (const [status, copy] of cases) {
      const view = communicationHttpErrorView(new ApiError("message API brut", status));
      expect(view.status).toBe(status);
      expect(view.title).toBe(copy.title);
      expect(view.message).toBe(copy.message);
      expect(view.httpLabel).toBe(`HTTP ${status}`);
      expect(view.message).not.toBe("message API brut");
    }

    expect(new Set(cases.map(([, copy]) => copy.title)).size).toBe(5);
  });

  it("403 et 401 utilisent ForbiddenState, 404 reste une erreur", () => {
    expect(usesForbiddenCommunicationState(communicationHttpErrorView(new ApiError("x", 403)).kind)).toBe(true);
    expect(usesForbiddenCommunicationState(communicationHttpErrorView(new ApiError("x", 401)).kind)).toBe(true);
    expect(usesForbiddenCommunicationState(communicationHttpErrorView(new ApiError("x", 404)).kind)).toBe(false);
    expect(usesForbiddenCommunicationState(communicationHttpErrorView(new ApiError("x", 500)).kind)).toBe(false);
  });

  it("conserve un repli hors ApiError, sans masquer l'absence de statut", () => {
    const view = communicationHttpErrorView(new Error("réseau coupé"), "Impossible de charger les conversations");
    expect(view.status).toBeNull();
    expect(view.httpLabel).toBeNull();
    expect(view.title).toBe("Une erreur est survenue");
    expect(view.message).toBe("réseau coupé");
  });
});
