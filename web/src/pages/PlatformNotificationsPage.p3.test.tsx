/**
 * AUDIT-COM-P3-02 — bandeau loading catalogue notifications plateforme.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlatformNotificationsPage } from "./PlatformNotificationsPage";

const data = vi.hoisted(() => ({
  loading: true,
  notifications: [] as Array<{ id: string; title: string; message: string; status: string; audience: string; date: string }>,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "sa-1", role: "Super Administrateur Somafrik", identifier: "SA" },
    },
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { id: "sa-1", role: "Super Administrateur Somafrik" },
  }),
  useFeaturePermissions: () => ({ canCreate: true, canUpdate: true, canDelete: true }),
}));

vi.mock("../lib/establishmentCommunication", () => ({
  isPlatformCommunicationUser: () => true,
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: { notifications: data.notifications },
    loading: data.loading,
    refresh: vi.fn(),
  }),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe("AUDIT-COM-P3-02 — loading notifications plateforme", () => {
  it("affiche un bandeau de chargement tant que le catalogue n'est pas prêt", () => {
    data.loading = true;
    data.notifications = [];
    render(<PlatformNotificationsPage />);
    expect(screen.getByText("Chargement des notifications plateforme…")).toBeInTheDocument();
    expect(screen.queryByText("Aucune notification.")).not.toBeInTheDocument();
  });

  it("affiche l'état vide seulement après chargement", () => {
    data.loading = false;
    data.notifications = [];
    render(<PlatformNotificationsPage />);
    expect(screen.queryByText("Chargement des notifications plateforme…")).not.toBeInTheDocument();
    expect(screen.getByText("Aucune notification.")).toBeInTheDocument();
  });
});
