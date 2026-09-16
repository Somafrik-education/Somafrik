import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";
import { SubscriptionAccessBanner } from "./SubscriptionAccessBanner";

const { getSubscriptionAccessMock, useAuthMock } = vi.hoisted(() => ({
  getSubscriptionAccessMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: useAuthMock,
}));

vi.mock("../lib/establishmentsApi", () => ({
  establishmentsApi: {
    getSubscriptionAccess: getSubscriptionAccessMock,
  },
}));

describe("SubscriptionAccessBanner — Démo", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    getSubscriptionAccessMock.mockReset();
  });

  it("n'appelle pas le contrôle d'abonnement et n'affiche aucun bandeau pour une session Démo", () => {
    const demoSession = {
      accessToken: "demo-token",
      user: {
        id: "demo-admin",
        identifier: "ADMIN-SCH-BULK-CD-0001-01",
        role: "Admin School",
        schoolCode: "SCH-BULK-CD-0001",
      },
      demo: true,
    } as Session & { demo: true };

    useAuthMock.mockReturnValue({ session: demoSession });

    render(<SubscriptionAccessBanner />);

    expect(getSubscriptionAccessMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Accès suspendu/i)).toBeNull();
    expect(screen.queryByText(/Accès limité/i)).toBeNull();
  });

  it("conserve le contrôle d'abonnement pour une session établissement normale", async () => {
    useAuthMock.mockReturnValue({
      session: {
        accessToken: "school-token",
        user: {
          id: "school-admin",
          identifier: "admin",
          role: "Admin School",
          schoolCode: "CD-2026-0001",
        },
      } as Session,
    });
    getSubscriptionAccessMock.mockResolvedValue({
      schoolCode: "CD-2026-0001",
      level: "blocked",
      lifecycle: "expired",
      daysLate: 1,
      message: "Abonnement expiré ou impayé.",
      plan: "Essentiel",
      paymentStatus: "unpaid",
    });

    render(<SubscriptionAccessBanner />);

    await waitFor(() => {
      expect(getSubscriptionAccessMock).toHaveBeenCalledWith("CD-2026-0001");
    });
    expect(await screen.findByText(/Accès suspendu/i)).toBeTruthy();
  });
});
