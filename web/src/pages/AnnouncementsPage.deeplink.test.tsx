/**
 * DEEPLINK-ANNONCE — `/annonces?announcementId=…` doit ouvrir l'annonce visée.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AnnouncementsPage } from "./AnnouncementsPage";

const showToast = vi.hoisted(() => vi.fn());
const schoolList = vi.hoisted(() => vi.fn());
const schoolGet = vi.hoisted(() => vi.fn());
const schoolMarkRead = vi.hoisted(() => vi.fn());
const platformList = vi.hoisted(() => vi.fn());
const platformGet = vi.hoisted(() => vi.fn());
const platformMarkRead = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" } } }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "SCH-001", requiresSelection: false }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({ canRead: true, canCreate: false, canUpdate: false }),
  usePermissionContext: () => ({}),
}));

vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));

vi.mock("../lib/announcementsApi", () => ({
  announcementsApi: {
    list: schoolList,
    get: schoolGet,
    markRead: schoolMarkRead,
    audienceOptions: vi.fn(),
    create: vi.fn(),
    archive: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

vi.mock("../lib/platformAnnouncementsApi", () => ({
  platformAnnouncementsApi: {
    list: platformList,
    get: platformGet,
    markRead: platformMarkRead,
    create: vi.fn(),
  },
}));

function announcement(id: string, title: string, readAt: string | null = null) {
  return {
    id,
    title,
    message: `Contenu ${id}`,
    type: "school-announcement",
    createdByName: "Direction",
    createdAt: "2026-09-09T08:00:00.000Z",
    publishedAt: "2026-09-09T08:00:00.000Z",
    readAt,
    attachments: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  platformList.mockResolvedValue({ items: [] });
  schoolList.mockResolvedValue({
    items: [announcement("ann-1", "Annonce ignorée", "2026-09-09T09:00:00.000Z"), announcement("ann-2", "Annonce visée")],
  });
  schoolGet.mockImplementation(async (id: string) => announcement(id, `Annonce ${id}`));
  schoolMarkRead.mockImplementation(async (id: string) => ({
    ...announcement(id, `Annonce ${id}`),
    readAt: "2026-09-09T10:00:00.000Z",
  }));
});

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/annonces${search}`]}>
      <AnnouncementsPage />
    </MemoryRouter>,
  );
}

describe("DEEPLINK-ANNONCE — la page Annonces consomme announcementId", () => {
  it("DEEPLINK-ANNONCE-01 — l'annonce visée est sélectionnée et son détail chargé", async () => {
    renderPage("?announcementId=ann-2");

    await waitFor(() => expect(schoolGet).toHaveBeenCalledWith("ann-2", "SCH-001"));
    const detail = await screen.findByTestId("announcement-detail");
    await waitFor(() => expect(detail).toHaveAttribute("data-announcement-id", "ann-2"));

    const items = screen.getAllByTestId("announcement-item");
    expect(items.find((node) => node.getAttribute("data-announcement-id") === "ann-2")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(items.find((node) => node.getAttribute("data-announcement-id") === "ann-1")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("DEEPLINK-ANNONCE-02 — une annonce non lue est marquée lue à l'ouverture", async () => {
    renderPage("?announcementId=ann-2");
    await waitFor(() => expect(schoolMarkRead).toHaveBeenCalledWith("ann-2", "SCH-001"));
  });

  it("DEEPLINK-ANNONCE-03 — une annonce de la plateforme est ouverte via l'API plateforme", async () => {
    platformList.mockResolvedValue({
      items: [{ ...announcement("plat-7", "Annonce Somafrik"), announcementType: "administrative" }],
    });
    platformGet.mockResolvedValue({ ...announcement("plat-7", "Annonce Somafrik") });
    platformMarkRead.mockResolvedValue({
      ...announcement("plat-7", "Annonce Somafrik"),
      readAt: "2026-09-09T10:00:00.000Z",
    });

    renderPage("?announcementId=plat-7");

    await waitFor(() => expect(platformGet).toHaveBeenCalledWith("plat-7"));
    expect(schoolGet).not.toHaveBeenCalledWith("plat-7", "SCH-001");
    const detail = await screen.findByTestId("announcement-detail");
    await waitFor(() => expect(detail).toHaveAttribute("data-announcement-id", "plat-7"));
  });

  it("DEEPLINK-ANNONCE-04 — sans paramètre, aucune annonce n'est ouverte d'office", async () => {
    renderPage("");
    await waitFor(() => expect(schoolList).toHaveBeenCalled());
    expect(schoolGet).not.toHaveBeenCalled();
    expect(screen.getByText("Sélectionnez une annonce.")).toBeInTheDocument();
  });
});
