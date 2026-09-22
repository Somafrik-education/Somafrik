/**
 * Lot C — RED-05 Web Annonces.
 * Pagination nextCursor sans doublon, perte, ni fuite tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../api/client";
import { AnnouncementsPage } from "./AnnouncementsPage";

const showToast = vi.hoisted(() => vi.fn());
const notifyUnread = vi.hoisted(() => vi.fn());
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

vi.mock("../lib/announcementsRead", () => ({
  notifyAnnouncementsUnreadChanged: () => notifyUnread(),
  useAnnouncementsUnreadCount: () => 0,
  ANNOUNCEMENTS_UNREAD_CHANGED_EVENT: "somafrik:announcements-unread-changed",
}));

vi.mock("../lib/announcementsApi", () => ({
  announcementsApi: {
    list: schoolList,
    get: schoolGet,
    markRead: schoolMarkRead,
    unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
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
    unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn(),
  },
}));

const NEXT_CURSOR = "2026-09-09T10:00:00.000Z|00000000-0000-4000-8000-000000000050";

function announcement(id: string, title: string, readAt: string | null = "2026-09-09T09:00:00.000Z") {
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/annonces"]}>
      <AnnouncementsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  platformList.mockResolvedValue({ items: [], nextCursor: null });
  schoolGet.mockImplementation(async (id: string) => announcement(id, `Annonce ${id}`));
  schoolMarkRead.mockImplementation(async (id: string) => ({
    ...announcement(id, `Annonce ${id}`),
    readAt: "2026-09-09T10:00:00.000Z",
  }));
});

describe("Lot C — Annonces Web pagination", () => {
  it("RED-05 — nextCursor école est renvoyé à l'API avec le même établissement", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      announcement(`ann-${index + 1}`, `Annonce ${index + 1}`),
    );
    schoolList.mockImplementation((schoolCode?: string, options?: { cursor?: string | null }) => {
      expect(schoolCode).toBe("SCH-001");
      if (options?.cursor === NEXT_CURSOR) {
        return Promise.resolve({
          items: [announcement("ann-1", "Annonce 1"), announcement("ann-51", "Annonce ancienne", null)],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: firstPage, nextCursor: NEXT_CURSOR });
    });

    renderPage();
    await screen.findByText("Annonce 1");
    expect(screen.queryByText("Annonce ancienne")).toBeNull();

    await userEvent.click(await screen.findByTestId("announcements-load-more"));
    await screen.findByText("Annonce ancienne");

    const ids = screen.getAllByTestId("announcement-item").map((node) => node.getAttribute("data-announcement-id"));
    expect(ids.filter((id) => id === "ann-1")).toHaveLength(1);
    expect(ids).toContain("ann-51");
    expect(ids).toHaveLength(51);

    await waitFor(() => {
      expect(schoolList.mock.calls.some((call) => call[1]?.cursor === NEXT_CURSOR)).toBe(true);
    });
    expect(schoolList.mock.calls.every((call) => call[0] === "SCH-001")).toBe(true);
    expect(platformList).toHaveBeenCalled();
  });

  it("RED-05 — sans page suivante, le bouton de chargement est absent", async () => {
    schoolList.mockResolvedValue({ items: [announcement("ann-1", "Annonce unique")], nextCursor: null });
    renderPage();
    await screen.findByText("Annonce unique");
    expect(screen.queryByTestId("announcements-load-more")).toBeNull();
  });

  it("P3-02 — GET annonces 404 affiche Introuvable et le statut HTTP", async () => {
    schoolList.mockRejectedValue(new ApiError("annonce absente", 404));
    platformList.mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    const banner = await screen.findByTestId("communication-http-error");
    expect(banner).toHaveAttribute("data-http-status", "404");
    expect(banner).toHaveTextContent("Ressource introuvable");
    expect(banner).toHaveTextContent("HTTP 404");
    expect(banner).not.toHaveTextContent("annonce absente");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
